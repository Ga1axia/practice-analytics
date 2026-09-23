import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  BQE_PROJECT_LIST_FIELDS,
  BqeHttpError,
  bqeGet,
  bqeListAll,
  bqeSinceDate,
  CORE_PROJECT_WHERE_ACTIVE,
  hydrateProjectParents,
  serviceSupabase,
  type BqeExpenseEntry,
  type BqeInvoice,
  type BqeProject,
  type BqeTimeEntry,
} from '../_lib/bqe.js';
import {
  applyTimeAndInvoices,
  filterInvoicesForActiveProjects,
  mapCoreProjects,
  type ProjectInsert,
} from '../_lib/bqeSyncBuild.js';
import { loadExistingProjectKeys } from '../_lib/projectHoursFilter.js';
import {
  persistFetchedTimeEntries,
  runTimeEntrySync,
  type TimeEntrySyncMode,
} from '../_lib/bqeTimeEntrySync.js';
import { requireAdmin } from '../_lib/requireAdmin.js';

type Sb = ReturnType<typeof serviceSupabase>;

type SyncBody = {
  mode?: 'historical' | 'incremental' | 'dry_run' | 'aggregates' | 'projects';
  since?: string;
  until?: string;
  /** Months of time/expense lookback for aggregates (default 2; invoices are all dates on active projects). */
  lookbackMonths?: number;
  /** When running aggregates, also persist raw time entries (incremental). */
  includeTimeEntries?: boolean;
  /** 1-based page for mode=projects (omit / 0 = fetch all — local only). */
  page?: number;
  pageSize?: number;
  /** Clear pa_projects before inserting this page (ignored once a library exists). */
  reset?: boolean;
  /** CORE where clause for /project (default: status=0 Active). */
  projectWhere?: string;
  /**
   * Ignored. Project status comes from CORE (Active=0 / Inactive=1 / Completed=2).
   * Kept so older clients that still send this flag do not fail.
   */
  requireRecentHours?: boolean;
};

async function clearTable(sb: Sb, table: string) {
  const { error } = await sb.from(table).delete().gte('id', 0);
  if (error) throw new Error(`Clear ${table} failed: ${error.message}`);
}

async function insertChunks<T extends Record<string, unknown>>(
  sb: Sb,
  table: string,
  rows: T[],
  chunkSize = 200,
): Promise<number> {
  if (!rows.length) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await sb.from(table).insert(chunk);
    if (error) throw new Error(`Insert ${table} failed: ${error.message}`);
    inserted += chunk.length;
  }
  return inserted;
}

/** Keep spent/billed/etc. when refreshing CORE status on existing library rows. */
async function preserveExistingProjectFinancials(
  sb: Sb,
  rows: ProjectInsert[],
): Promise<ProjectInsert[]> {
  if (!rows.length) return rows;
  const prevByKey = new Map<string, ProjectInsert>();
  for (let i = 0; i < rows.length; i += 200) {
    const keys = rows.slice(i, i + 200).map((r) => r.project);
    const { data, error } = await sb
      .from('pa_projects')
      .select(
        'project,spent,billed,pct_used,pct_billed,retainer_paid,retainer_balance,ar,profit,margin,billed_hours,spent_hours,contract_outstanding',
      )
      .in('project', keys);
    if (error) throw new Error(`Load project financials failed: ${error.message}`);
    for (const row of data || []) {
      const rec = row as ProjectInsert;
      if (rec.project) prevByKey.set(rec.project, rec);
    }
  }
  if (!prevByKey.size) return rows;
  return rows.map((r) => {
    const prev = prevByKey.get(r.project);
    if (!prev) return r;
    return {
      ...r,
      spent: prev.spent ?? r.spent,
      billed: prev.billed ?? r.billed,
      pct_used: prev.pct_used ?? r.pct_used,
      pct_billed: prev.pct_billed ?? r.pct_billed,
      retainer_paid: prev.retainer_paid ?? r.retainer_paid,
      retainer_balance: prev.retainer_balance ?? r.retainer_balance,
      ar: prev.ar ?? r.ar,
      profit: prev.profit ?? r.profit,
      margin: prev.margin ?? r.margin,
      billed_hours: prev.billed_hours ?? r.billed_hours,
      spent_hours: prev.spent_hours ?? r.spent_hours,
      contract_outstanding: prev.contract_outstanding ?? r.contract_outstanding,
    };
  });
}

async function tryList<T>(
  label: string,
  fn: () => Promise<T[]>,
  warnings: string[],
): Promise<T[]> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof BqeHttpError) {
      if (e.status === 403 || e.status === 401) {
        const sub = /not subscribed/i.test(e.body)
          ? `${label}: CORE subscription does not include this module (skipped)`
          : `${label}: access denied (${e.status}) — skipped`;
        warnings.push(sub);
        return [];
      }
      // Module Security — UI may allow Time Entry screen but not Employee/Client APIs
      if (e.status === 409 && /SEC_Module/i.test(e.body)) {
        warnings.push(
          `${label}: Module Security blocked this API for the connected CORE user (skipped)`,
        );
        return [];
      }
    }
    throw e;
  }
}

function asProjectList(payload: unknown): BqeProject[] {
  if (Array.isArray(payload)) return payload as BqeProject[];
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['value', 'data', 'items', 'results']) {
      if (Array.isArray(obj[key])) return obj[key] as BqeProject[];
    }
  }
  return [];
}

function parseBody(req: VercelRequest): SyncBody {
  const raw = req.body;
  if (!raw || typeof raw !== 'object') return {};
  return raw as SyncBody;
}

/** Allow longer CORE pagination + DB replace on Vercel. */
export const config = { maxDuration: 300 };

/**
 * BQE CORE sync.
 * - mode=projects: projects only (Vercel-safe, ~seconds). Practice roster is admin-managed.
 * - mode omitted / aggregates: analytics replace (time/expense lookback; invoices all dates on active projects).
 * - mode=historical|incremental|dry_run: persist (or count) raw time entries;
 *   pass since+until (YYYY-MM-DD) to keep each call under serverless limits.
 * - includeTimeEntries on aggregates: also persist fetched TE rows.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const body = parseBody(req);
    const mode = body.mode;

    if (mode === 'historical' || mode === 'incremental' || mode === 'dry_run') {
      const sb = serviceSupabase();
      const result = await runTimeEntrySync(sb, {
        mode: mode as TimeEntrySyncMode,
        since: body.since,
        until: body.until,
        page: body.page,
        pageSize: body.pageSize,
        initiatedBy: admin.userId,
      });
      const statusCode = result.status === 'failed' ? 500 : 200;
      res.status(statusCode).json({
        ok: result.status !== 'failed',
        syncRunId: result.syncRunId,
        status: result.status,
        mode: result.mode,
        since: result.since,
        until: result.until,
        fetched: result.fetched,
        inserted: result.inserted,
        updated: result.updated,
        skipped: result.skipped,
        cursor: result.cursor,
        lastUpdatedCursor: result.lastUpdatedCursor,
        hasMore: result.hasMore,
        page: result.page,
        warnings: result.warnings,
        error: result.error,
        message:
          result.status === 'failed'
            ? result.error
            : `Time entry ${result.mode}: fetched ${result.fetched}, inserted ${result.inserted}, updated ${result.updated}, skipped ${result.skipped}.`,
      });
      return;
    }

    // --- Projects (paged on Vercel; full list locally) ---
    if (mode === 'projects') {
      const sb = serviceSupabase();
      try {
        const warnings: string[] = [];
        const page = Number(body.page) > 0 ? Math.floor(Number(body.page)) : 0;
        const pageSize = Math.min(Math.max(Number(body.pageSize) || 100, 25), 200);
        const existingKeys = await loadExistingProjectKeys(sb);
        const libraryExists = existingKeys.size > 0;
        const rawWhere = (body.projectWhere || '').trim();
        const query: Record<string, string> = {
          fields: BQE_PROJECT_LIST_FIELDS,
        };
        // '*' / 'all' mean unfiltered — CORE WHERE cannot be `*`.
        if (rawWhere && rawWhere !== '*' && !/^all$/i.test(rawWhere)) {
          query.where = rawWhere;
        }
        if (query.where) warnings.push(`CORE project fetch (${query.where})`);
        else warnings.push('CORE project fetch (all statuses — phase Completed included)');

        let projects: BqeProject[] = [];
        let hasMore = false;
        let usedUnfilteredFallback = false;
        const onVercel = process.env.VERCEL === '1';
        if (page > 0) {
          const payload = await bqeGet<unknown>('/project', {
            ...query,
            page: `${page},${pageSize}`,
          });
          projects = asProjectList(payload);
          // Hobby-safe: if Active filter returns nothing, page the full catalog once.
          if (
            page === 1 &&
            !rawWhere &&
            projects.length === 0 &&
            query.where === CORE_PROJECT_WHERE_ACTIVE
          ) {
            delete query.where;
            usedUnfilteredFallback = true;
            warnings.push('CORE status=0 returned 0 rows — paging all projects');
            const retry = await bqeGet<unknown>('/project', {
              ...query,
              page: `${page},${pageSize}`,
            });
            projects = asProjectList(retry);
          }
          hasMore = projects.length >= pageSize;
        } else {
          projects = await bqeListAll<BqeProject>('/project', 500, query);
        }
        if (projects.length) {
          projects = await hydrateProjectParents(projects, onVercel ? 6 : 40);
        }

        const mapped = mapCoreProjects(projects);
        if (mapped.excludedCount) {
          warnings.push(
            `Excluded ${mapped.excludedCount} test / Internal Office rows from this page`,
          );
        }

        if (!libraryExists && (body.reset || page <= 1)) {
          await clearTable(sb, 'pa_projects');
        }
        let insertedProjects = 0;
        if (mapped.rows.length) {
          const rows = await preserveExistingProjectFinancials(sb, mapped.rows);
          const { error: upErr } = await sb
            .from('pa_projects')
            .upsert(rows as unknown as Record<string, unknown>[], {
              onConflict: 'project',
            });
          if (upErr) throw new Error(`Upsert projects failed: ${upErr.message}`);
          insertedProjects = rows.length;
        }
        const msg =
          page > 0
            ? `Projects page ${page}: CORE ${projects.length} → +${insertedProjects} rows` +
              (hasMore ? ' (more…)' : ' (done)')
            : `Projects sync: ${projects.length} CORE → ${insertedProjects} rows`;

        await sb
          .from('pa_bqe_connection')
          .update({
            last_sync_at: new Date().toISOString(),
            last_sync_status: warnings.length ? 'ok_partial' : 'ok',
            last_sync_message: msg.slice(0, 900),
            updated_at: new Date().toISOString(),
          })
          .eq('id', 1);

        res.status(200).json({
          ok: true,
          mode: 'projects',
          page: page || null,
          pageSize: page > 0 ? pageSize : null,
          hasMore,
          coreProjects: projects.length,
          insertedProjects,
          libraryExists,
          usedUnfilteredFallback,
          projectWhere: query.where || null,
          warnings,
          message: msg,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'projects sync failed';
        res.status(500).json({ error: msg });
      }
      return;
    }

    const sb = serviceSupabase();
    try {
      const onVercel = process.env.VERCEL === '1';
      const lookback =
        typeof body.lookbackMonths === 'number' && body.lookbackMonths > 0
          ? Math.min(Math.floor(body.lookbackMonths), 36)
          : 2;
      const since = bqeSinceDate(lookback);
      const whereDate = `date >= '${since}'`;
      const warnings: string[] = [];
      warnings.push(
        `Analytics lookback ${lookback} month(s). Use Import historical time entries for older time.`,
      );

      const existingKeys = await loadExistingProjectKeys(sb);
      const libraryExists = existingKeys.size > 0;
      const projectQuery: Record<string, string> = {
        fields: BQE_PROJECT_LIST_FIELDS,
      };
      warnings.push('CORE project fetch (all statuses)');

      // Sequential on purpose — CORE rate limit is ~100 calls/min
      let projects = await bqeListAll<BqeProject>('/project', 500, projectQuery);
      if (projects.length) {
        projects = await hydrateProjectParents(projects);
      }

      const timeEntries = await tryList(
        'Time Entry',
        () =>
          bqeListAll<BqeTimeEntry>('/timeentry', 1000, {
            where: whereDate,
            fields:
              'id,date,projectId,project,client,activity,activityId,resourceId,resource,actualHours,clientHours,billable,billRate,costRate,billStatus,wudMultiplier,extra,isWrittenOff,description,memo,invoiceId,createdOn,lastUpdated',
          }),
        warnings,
      );

      const expenseEntries = await tryList(
        'Expense Entry',
        () =>
          bqeListAll<BqeExpenseEntry>('/expenseentry', 500, {
            where: whereDate,
            fields:
              'date,projectId,project,billable,billStatus,units,costRate,chargeAmount,markup,isWrittenOff',
          }),
        warnings,
      );

      const mapped = mapCoreProjects(projects);

      let invoicesFetched = await tryList(
        'Invoice',
        () =>
          bqeListAll<BqeInvoice>('/invoice', 100, {
            expand: 'invoiceDetails',
          }),
        warnings,
      );
      if (!invoicesFetched.length && !warnings.some((w) => w.startsWith('Invoice'))) {
        invoicesFetched = await tryList(
          'Invoice',
          () => bqeListAll<BqeInvoice>('/invoice', 500, {}),
          warnings,
        );
      }
      const invoices = filterInvoicesForActiveProjects(invoicesFetched, mapped);
      if (invoicesFetched.length) {
        warnings.push(
          `Invoices: ${invoices.length} on active projects (paged ${invoicesFetched.length} from CORE, all dates)`,
        );
      }

      const built = applyTimeAndInvoices(
        mapped,
        timeEntries,
        invoices,
        expenseEntries,
      );
      if (mapped.excludedCount) {
        warnings.push(
          `Excluded ${mapped.excludedCount} test / Internal Office CORE rows from project list (hours still counted for firm efficiency)`,
        );
      }

      if (!invoices.length) {
        warnings.push(
          'Invoice module unavailable — Billed from time/expense billStatus; Spent from billable WIP value. A/R aging not updated.',
        );
      }

      if (!libraryExists) {
        await clearTable(sb, 'pa_projects');
      }
      await clearTable(sb, 'pa_employee_monthly');
      await clearTable(sb, 'pa_employee_totals');
      await clearTable(sb, 'pa_company_monthly');
      await clearTable(sb, 'pa_project_monthly_billed');
      await clearTable(sb, 'pa_client_monthly_billed');

      if (invoices.length) {
        await clearTable(sb, 'pa_ar_clients');
        await clearTable(sb, 'pa_invoice_ledger');
        await clearTable(sb, 'pa_monthly_revenue');
      }

      let insertedProjects = 0;
      if (built.projects.length) {
        if (libraryExists) {
          const { error: upErr } = await sb
            .from('pa_projects')
            .upsert(built.projects as unknown as Record<string, unknown>[], {
              onConflict: 'project',
            });
          if (upErr) throw new Error(`Upsert projects failed: ${upErr.message}`);
          insertedProjects = built.projects.length;
        } else {
          insertedProjects = await insertChunks(sb, 'pa_projects', built.projects);
        }
      }
      await insertChunks(sb, 'pa_employee_monthly', built.empMonthly);
      await insertChunks(sb, 'pa_employee_totals', built.empTotals);
      await insertChunks(sb, 'pa_company_monthly', built.companyMonthly);
      await insertChunks(sb, 'pa_project_monthly_billed', built.projectMonthlyBilled);
      await insertChunks(sb, 'pa_client_monthly_billed', built.clientMonthlyBilled);

      if (invoices.length) {
        await insertChunks(sb, 'pa_ar_clients', built.arClients);
        await insertChunks(sb, 'pa_invoice_ledger', built.invoiceLedger);
        await insertChunks(sb, 'pa_monthly_revenue', built.monthlyRevenue);
      }

      // Persist TE only when asked — default OFF on Vercel to stay under timeout
      let timeEntryPersist: Awaited<ReturnType<typeof persistFetchedTimeEntries>> | null = null;
      const shouldPersistTe =
        (body.includeTimeEntries === true || (!onVercel && body.includeTimeEntries !== false)) &&
        timeEntries.length > 0;
      if (shouldPersistTe) {
        timeEntryPersist = await persistFetchedTimeEntries(sb, timeEntries, projects, {
          initiatedBy: admin.userId,
          since,
        });
        if (timeEntryPersist.error) {
          warnings.push(`Time entry persist: ${timeEntryPersist.error}`);
        } else {
          warnings.push(
            `Time entries persisted: +${timeEntryPersist.inserted} / ~${timeEntryPersist.updated}`,
          );
        }
      }

      const msg =
        `Synced from BQE CORE since ${since}: ` +
        `${projects.length} projects → ${insertedProjects} rows · ` +
        `${built.stats.timeEntries} time entries (${built.stats.matchedTime} matched) · ` +
        `${built.stats.expenseEntries} expenses (${built.stats.matchedExpenses} matched) · ` +
        `${built.stats.invoices} invoices (${built.stats.matchedInvoiceLines} project lines) · ` +
        `${built.empTotals.length} employee hour totals` +
        (warnings.length ? ` · Notes: ${warnings.join(' | ')}` : '') +
        '.';

      await sb
        .from('pa_bqe_connection')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: warnings.length ? 'ok_partial' : 'ok',
          last_sync_message: msg.slice(0, 900),
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);

      res.status(200).json({
        ok: true,
        mode: 'aggregates',
        since,
        lookbackMonths: lookback,
        libraryExists,
        coreProjects: projects.length,
        timeEntries: built.stats.timeEntries,
        invoices: built.stats.invoices,
        employees: built.empTotals.length,
        insertedProjects,
        warnings,
        message: msg,
        timeEntrySync: timeEntryPersist
          ? {
              syncRunId: timeEntryPersist.syncRunId,
              status: timeEntryPersist.status,
              fetched: timeEntryPersist.fetched,
              inserted: timeEntryPersist.inserted,
              updated: timeEntryPersist.updated,
              skipped: timeEntryPersist.skipped,
              cursor: timeEntryPersist.cursor,
              lastUpdatedCursor: timeEntryPersist.lastUpdatedCursor,
              error: timeEntryPersist.error,
            }
          : null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'sync failed';
      try {
        await sb
          .from('pa_bqe_connection')
          .update({
            last_sync_at: new Date().toISOString(),
            last_sync_status: 'error',
            last_sync_message: msg.slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq('id', 1);
      } catch {
        /* ignore */
      }
      res.status(500).json({ error: msg });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'sync failed';
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    }
  }
}
