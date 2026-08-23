import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BQE_TIME_ENTRY_PERSIST_FIELDS,
  bqeListAll,
  bqeSinceDate,
  type BqeProject,
  type BqeTimeEntry,
} from './bqe';
import { mapCoreProjects, type MappedProjects } from './bqeSyncBuild';

export type TimeEntrySyncMode = 'historical' | 'incremental' | 'dry_run';

export type TimeEntrySyncRequest = {
  mode: TimeEntrySyncMode;
  since?: string;
  until?: string;
  initiatedBy?: string | null;
};

export type TimeEntrySyncResult = {
  syncRunId: string;
  status: 'succeeded' | 'failed' | 'partial';
  mode: TimeEntrySyncMode;
  since: string | null;
  until: string | null;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  cursor: string | null;
  lastUpdatedCursor: string | null;
  warnings: string[];
  error: string | null;
};

export type TimeEntryRow = {
  bqe_time_entry_id: string;
  employee_id: string | null;
  employee_name: string | null;
  project_id: string | null;
  project_name: string | null;
  parent_project_name: string | null;
  phase: string | null;
  phase_name: string | null;
  client: string | null;
  activity_id: string | null;
  activity: string | null;
  work_date: string;
  actual_hours: number;
  client_hours: number | null;
  is_billable: boolean;
  is_written_off: boolean;
  is_extra: boolean;
  bill_status: number | null;
  invoice_id: string | null;
  description: string | null;
  memo: string | null;
  bqe_created_at: string | null;
  bqe_last_updated_at: string | null;
  raw_payload: Record<string, unknown>;
  synced_at: string;
  updated_at: string;
};

const OVERLAP_MS = 48 * 60 * 60 * 1000;
const SENSITIVE_KEYS = new Set([
  'billRate',
  'costRate',
  'billrate',
  'costrate',
  'BillRate',
  'CostRate',
]);

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function parseIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1]!;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return ymd(d);
}

function toIsoOrNull(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Strip compensation rates from stored payload. */
export function sanitizeTimeEntryPayload(te: BqeTimeEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(te as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

type PhaseContext = {
  parentName: string | null;
  phase: string | null;
  phaseName: string | null;
  projectName: string | null;
};

function buildPhaseLookup(
  projects: BqeProject[],
  mapped: MappedProjects,
): Map<string, PhaseContext> {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const out = new Map<string, PhaseContext>();

  for (const p of projects) {
    if (mapped.excludedIds.has(p.id)) continue;
    const parentId = p.parentId && byId.has(p.parentId) ? p.parentId : null;
    const parent = parentId ? byId.get(parentId) : null;
    const parentKey = parentId ? mapped.idToKey.get(parentId) || null : null;
    const selfKey = mapped.idToKey.get(p.id) || null;

    if (parent) {
      const phaseName = (p.phaseDescription || p.phaseName || p.displayName || p.name || 'Phase')
        .trim();
      out.set(p.id, {
        parentName: parentKey || parent.displayName || parent.name || null,
        phase: phaseName,
        phaseName,
        projectName: selfKey || `${parentKey || parent.name} - ${phaseName}`,
      });
    } else {
      out.set(p.id, {
        parentName: selfKey || p.displayName || p.name || null,
        phase: null,
        phaseName: null,
        projectName: selfKey || p.displayName || p.name || null,
      });
    }
  }
  return out;
}

export function mapBqeTimeEntryToRow(
  te: BqeTimeEntry,
  phaseLookup: Map<string, PhaseContext>,
  nowIso = new Date().toISOString(),
): TimeEntryRow | null {
  const id = (te.id || '').trim();
  if (!id) return null;
  const workDate = parseIsoDate(te.date);
  if (!workDate) return null;

  const ctx = te.projectId ? phaseLookup.get(te.projectId) : undefined;
  const billStatusRaw = te.billStatus;
  const billStatus =
    billStatusRaw == null || billStatusRaw === ''
      ? null
      : Number.isFinite(Number(billStatusRaw))
        ? Number(billStatusRaw)
        : null;

  let projectName = ctx?.projectName || te.project || null;
  let parentName = ctx?.parentName || null;
  let phase = ctx?.phase || null;
  let phaseName = ctx?.phaseName || null;
  // Fallback when hierarchy map is unavailable: "Parent - Phase"
  if (!phase && projectName) {
    const m = projectName.match(/\s[-–]\s(.+)$/);
    if (m) {
      phase = m[1]!.trim();
      phaseName = phase;
      parentName = parentName || projectName.slice(0, m.index).trim();
    }
  }

  return {
    bqe_time_entry_id: id,
    employee_id: te.resourceId || null,
    employee_name: (te.resource || '').trim() || null,
    project_id: te.projectId || null,
    project_name: projectName,
    parent_project_name: parentName,
    phase,
    phase_name: phaseName,
    client: te.client || null,
    activity_id: te.activityId || null,
    activity: te.activity || null,
    work_date: workDate,
    actual_hours: Number(te.actualHours) || 0,
    client_hours:
      te.clientHours == null || te.clientHours === ('' as unknown)
        ? null
        : Number(te.clientHours) || 0,
    is_billable: !!te.billable,
    is_written_off: !!te.isWrittenOff,
    is_extra: !!te.extra,
    bill_status: billStatus,
    invoice_id: te.invoiceId || null,
    description: te.description || null,
    memo: te.memo || null,
    bqe_created_at: toIsoOrNull(te.createdOn),
    bqe_last_updated_at: toIsoOrNull(te.lastUpdated),
    raw_payload: sanitizeTimeEntryPayload(te),
    synced_at: nowIso,
    updated_at: nowIso,
  };
}

async function startRun(
  sb: SupabaseClient,
  req: TimeEntrySyncRequest,
  since: string | null,
  until: string | null,
): Promise<string> {
  const { data, error } = await sb
    .from('pa_bqe_sync_runs')
    .insert({
      sync_type: req.mode,
      status: 'running',
      since_date: since,
      until_date: until,
      initiated_by: req.initiatedBy || null,
      metadata: {},
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message || 'Failed to create sync run');
  return data.id as string;
}

async function finishRun(
  sb: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
) {
  const { error } = await sb
    .from('pa_bqe_sync_runs')
    .update({ ...patch, completed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`Failed to update sync run: ${error.message}`);
}

export async function loadIncrementalSince(sb: SupabaseClient): Promise<string> {
  const { data } = await sb
    .from('pa_bqe_sync_runs')
    .select('last_updated_cursor, since_date, completed_at')
    .in('sync_type', ['historical', 'incremental'])
    .eq('status', 'succeeded')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data?.last_updated_cursor) {
    const t = new Date(data.last_updated_cursor).getTime() - OVERLAP_MS;
    return ymd(new Date(t));
  }

  const { data: maxRow } = await sb
    .from('pa_time_entries')
    .select('bqe_last_updated_at, work_date')
    .order('bqe_last_updated_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (maxRow?.bqe_last_updated_at) {
    const t = new Date(maxRow.bqe_last_updated_at).getTime() - OVERLAP_MS;
    return ymd(new Date(t));
  }
  if (maxRow?.work_date) {
    const t = new Date(String(maxRow.work_date) + 'T00:00:00Z').getTime() - OVERLAP_MS;
    return ymd(new Date(t));
  }

  return bqeSinceDate(36);
}

async function existingIds(
  sb: SupabaseClient,
  ids: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  const chunk = 200;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const { data, error } = await sb
      .from('pa_time_entries')
      .select('bqe_time_entry_id')
      .in('bqe_time_entry_id', slice);
    if (error) throw new Error(error.message);
    for (const row of data || []) found.add(row.bqe_time_entry_id as string);
  }
  return found;
}

export async function upsertTimeEntryRows(
  sb: SupabaseClient,
  rows: TimeEntryRow[],
): Promise<{ inserted: number; updated: number }> {
  if (!rows.length) return { inserted: 0, updated: 0 };

  // CORE pagination / retries can yield the same id twice; Postgres rejects
  // ON CONFLICT when one INSERT would update the same row twice.
  const byId = new Map<string, TimeEntryRow>();
  for (const r of rows) {
    if (!r.bqe_time_entry_id) continue;
    byId.set(r.bqe_time_entry_id, r);
  }
  const unique = [...byId.values()];

  const ids = unique.map((r) => r.bqe_time_entry_id);
  const before = await existingIds(sb, ids);
  let inserted = 0;
  let updated = 0;
  const chunk = 150;
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    const { error } = await sb.from('pa_time_entries').upsert(slice, {
      onConflict: 'bqe_time_entry_id',
    });
    if (error) throw new Error(`Upsert time entries failed: ${error.message}`);
    for (const r of slice) {
      if (before.has(r.bqe_time_entry_id)) updated += 1;
      else inserted += 1;
    }
  }
  return { inserted, updated };
}

/** Persist already-fetched CORE time entries (e.g. from aggregate sync) without re-fetching. */
export async function persistFetchedTimeEntries(
  sb: SupabaseClient,
  timeEntries: BqeTimeEntry[],
  projects: BqeProject[],
  opts?: { initiatedBy?: string | null; since?: string | null },
): Promise<TimeEntrySyncResult> {
  const warnings: string[] = [];
  const since = opts?.since || null;
  const runId = await startRun(
    sb,
    { mode: 'incremental', initiatedBy: opts?.initiatedBy },
    since,
    null,
  );
  try {
    const mapped = mapCoreProjects(projects);
    const phaseLookup = buildPhaseLookup(projects, mapped);
    const nowIso = new Date().toISOString();
    const rows: TimeEntryRow[] = [];
    let skipped = 0;
    let maxUpdated: string | null = null;
    for (const te of timeEntries) {
      const row = mapBqeTimeEntryToRow(te, phaseLookup, nowIso);
      if (!row) {
        skipped += 1;
        continue;
      }
      rows.push(row);
      if (row.bqe_last_updated_at && (!maxUpdated || row.bqe_last_updated_at > maxUpdated)) {
        maxUpdated = row.bqe_last_updated_at;
      }
    }
    const { inserted, updated } = await upsertTimeEntryRows(sb, rows);
    const cursor = ymd(new Date());
    await finishRun(sb, runId, {
      status: 'succeeded',
      entries_fetched: timeEntries.length,
      entries_inserted: inserted,
      entries_updated: updated,
      entries_skipped: skipped,
      last_cursor: cursor,
      last_updated_cursor: maxUpdated || nowIso,
      metadata: { source: 'aggregate_sync_reuse', projectCount: projects.length },
      error: null,
    });
    return {
      syncRunId: runId,
      status: 'succeeded',
      mode: 'incremental',
      since,
      until: null,
      fetched: timeEntries.length,
      inserted,
      updated,
      skipped,
      cursor,
      lastUpdatedCursor: maxUpdated || nowIso,
      warnings,
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'persist time entries failed';
    try {
      await finishRun(sb, runId, { status: 'failed', error: msg.slice(0, 900) });
    } catch {
      /* ignore */
    }
    return {
      syncRunId: runId,
      status: 'failed',
      mode: 'incremental',
      since,
      until: null,
      fetched: timeEntries.length,
      inserted: 0,
      updated: 0,
      skipped: 0,
      cursor: null,
      lastUpdatedCursor: null,
      warnings,
      error: msg,
    };
  }
}

/**
 * Persist (or dry-run) BQE time entries. Does not touch aggregate analytics tables.
 */
export async function runTimeEntrySync(
  sb: SupabaseClient,
  req: TimeEntrySyncRequest,
): Promise<TimeEntrySyncResult> {
  const warnings: string[] = [];
  let since: string | null = null;
  let until: string | null = req.until || null;

  if (req.mode === 'historical' || req.mode === 'dry_run') {
    since = req.since || bqeSinceDate(36);
  } else {
    since = req.since || (await loadIncrementalSince(sb));
  }

  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error('since must be YYYY-MM-DD');
  }
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    throw new Error('until must be YYYY-MM-DD');
  }

  const runId = await startRun(sb, req, since, until);

  try {
    // Project hierarchy for phase mapping (sequential — rate limit)
    const projects = await bqeListAll<BqeProject>('/project', 500);
    const mapped = mapCoreProjects(projects);
    const phaseLookup = buildPhaseLookup(projects, mapped);

    let where = since ? `date >= '${since}'` : '';
    if (until) {
      where = where ? `${where} AND date <= '${until}'` : `date <= '${until}'`;
    }

    const timeEntries = await bqeListAll<BqeTimeEntry>('/timeentry', 1000, {
      where,
      fields: BQE_TIME_ENTRY_PERSIST_FIELDS,
    });

    const nowIso = new Date().toISOString();
    const rows: TimeEntryRow[] = [];
    let skipped = 0;
    let maxUpdated: string | null = null;

    for (const te of timeEntries) {
      const row = mapBqeTimeEntryToRow(te, phaseLookup, nowIso);
      if (!row) {
        skipped += 1;
        continue;
      }
      rows.push(row);
      if (row.bqe_last_updated_at) {
        if (!maxUpdated || row.bqe_last_updated_at > maxUpdated) {
          maxUpdated = row.bqe_last_updated_at;
        }
      }
    }

    let inserted = 0;
    let updated = 0;
    if (req.mode !== 'dry_run') {
      const result = await upsertTimeEntryRows(sb, rows);
      inserted = result.inserted;
      updated = result.updated;
    } else {
      warnings.push('dry_run: fetched and mapped entries; no writes performed');
    }

    const cursor = until || ymd(new Date());
    const status = 'succeeded' as const;

    await finishRun(sb, runId, {
      status,
      entries_fetched: timeEntries.length,
      entries_inserted: inserted,
      entries_updated: updated,
      entries_skipped: skipped,
      last_cursor: cursor,
      last_updated_cursor: maxUpdated || nowIso,
      metadata: {
        projectCount: projects.length,
        mappedRows: mapped.rows.length,
        overlapHours: req.mode === 'incremental' ? 48 : 0,
      },
      error: null,
    });

    return {
      syncRunId: runId,
      status,
      mode: req.mode,
      since,
      until,
      fetched: timeEntries.length,
      inserted,
      updated,
      skipped,
      cursor,
      lastUpdatedCursor: maxUpdated || nowIso,
      warnings,
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'time entry sync failed';
    try {
      await finishRun(sb, runId, {
        status: 'failed',
        error: msg.slice(0, 900),
      });
    } catch {
      /* ignore */
    }
    return {
      syncRunId: runId,
      status: 'failed',
      mode: req.mode,
      since,
      until,
      fetched: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      cursor: null,
      lastUpdatedCursor: null,
      warnings,
      error: msg,
    };
  }
}
