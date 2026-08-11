import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  bqeListAll,
  bqeSinceDate,
  serviceSupabase,
  type BqeEmployee,
  type BqeInvoice,
  type BqeProject,
  type BqeTimeEntry,
} from '../_lib/bqe';
import {
  applyTimeAndInvoices,
  mapCoreProjects,
  mapEmployeesToRoster,
} from '../_lib/bqeSyncBuild';
import { requireAdmin } from '../_lib/requireAdmin';

type Sb = ReturnType<typeof serviceSupabase>;

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

/** Allow longer CORE pagination + DB replace on Vercel. */
export const config = { maxDuration: 300 };

/**
 * Full CORE sync: projects + time entries + invoices + employees.
 * Replaces local analytics tables with live CORE-derived figures (no Excel merge).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const sb = serviceSupabase();
    try {
      const since = bqeSinceDate(36);
      const whereDate = `date >= '${since}'`;

      async function listOrThrow<T>(
        path: string,
        pageSize: number,
        query?: Record<string, string>,
        fallbackQuery?: Record<string, string>,
      ): Promise<T[]> {
        try {
          return await bqeListAll<T>(path, pageSize, query);
        } catch (e) {
          if (!fallbackQuery) throw e;
          return bqeListAll<T>(path, pageSize, fallbackQuery);
        }
      }

      const [projects, timeEntries, invoices, employees] = await Promise.all([
        bqeListAll<BqeProject>('/project', 500),
        listOrThrow<BqeTimeEntry>(
          '/timeentry',
          500,
          {
            where: whereDate,
            fields:
              'date,projectId,resourceId,resource,actualHours,billable,billRate,costRate,isWrittenOff',
          },
          { where: whereDate },
        ),
        listOrThrow<BqeInvoice>(
          '/invoice',
          100,
          { where: whereDate, expand: 'invoiceDetails' },
          { where: whereDate },
        ),
        listOrThrow<BqeEmployee>(
          '/employee',
          200,
          { fields: 'id,firstName,lastName,status,department,title' },
          undefined,
        ).catch(() => bqeListAll<BqeEmployee>('/employee', 200)),
      ]);

      const mapped = mapCoreProjects(projects);
      const built = applyTimeAndInvoices(mapped, timeEntries, invoices);
      const roster = mapEmployeesToRoster(employees);

      // Replace dependent tables
      await clearTable(sb, 'pa_projects');
      await clearTable(sb, 'pa_employee_monthly');
      await clearTable(sb, 'pa_employee_totals');
      await clearTable(sb, 'pa_employee_roster');
      await clearTable(sb, 'pa_ar_clients');
      await clearTable(sb, 'pa_invoice_ledger');
      await clearTable(sb, 'pa_monthly_revenue');
      await clearTable(sb, 'pa_company_monthly');
      await clearTable(sb, 'pa_project_monthly_billed');
      await clearTable(sb, 'pa_client_monthly_billed');

      const insertedProjects = await insertChunks(sb, 'pa_projects', built.projects);
      await insertChunks(sb, 'pa_employee_monthly', built.empMonthly);
      await insertChunks(sb, 'pa_employee_totals', built.empTotals);
      await insertChunks(sb, 'pa_employee_roster', roster);
      await insertChunks(sb, 'pa_ar_clients', built.arClients);
      await insertChunks(sb, 'pa_invoice_ledger', built.invoiceLedger);
      await insertChunks(sb, 'pa_monthly_revenue', built.monthlyRevenue);
      await insertChunks(sb, 'pa_company_monthly', built.companyMonthly);
      await insertChunks(sb, 'pa_project_monthly_billed', built.projectMonthlyBilled);
      await insertChunks(sb, 'pa_client_monthly_billed', built.clientMonthlyBilled);

      const msg =
        `Synced from BQE CORE since ${since}: ` +
        `${projects.length} projects → ${insertedProjects} rows · ` +
        `${built.stats.timeEntries} time entries (${built.stats.matchedTime} matched) · ` +
        `${built.stats.invoices} invoices (${built.stats.matchedInvoiceLines} project lines) · ` +
        `${roster.length} employees · ` +
        `${built.empTotals.length} employee hour totals · ` +
        `${built.arClients.length} A/R clients.`;

      await sb
        .from('pa_bqe_connection')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: 'ok',
          last_sync_message: msg.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);

      res.status(200).json({
        ok: true,
        since,
        coreProjects: projects.length,
        timeEntries: built.stats.timeEntries,
        invoices: built.stats.invoices,
        employees: employees.length,
        insertedProjects,
        message: msg,
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
