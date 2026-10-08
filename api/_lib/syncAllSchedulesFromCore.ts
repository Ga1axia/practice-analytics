import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCorePhases } from '../../src/lib/scheduleCorePhases.js';
import { resyncProjectScheduleFromCore } from '../../src/lib/scheduleCoreResync.js';

export type SyncAllSchedulesResult = {
  ok: true;
  projects: number;
  synced: number;
  skippedNoPhases: number;
  errors: string[];
  startIndex: number;
  nextIndex: number;
  hasMore: boolean;
};

type ProjectHeader = {
  project: string;
  client: string | null;
  manager: string | null;
  status: string | null;
};

type SyncOpts = {
  activeOnly?: boolean;
  /** 0-based index into ACTIVE headers to start (default 0). */
  startIndex?: number;
  /** Stop after this many projects (0 = no cap except time budget). */
  maxProjects?: number;
  /** Stop when Date.now() >= this ms timestamp. */
  deadlineMs?: number;
  /** When true, reset stored cron offset to 0 before running. */
  resetStoredOffset?: boolean;
  /** Persist next index on pa_bqe_connection for cron continuation. */
  persistOffset?: boolean;
};

async function fetchAllProjectHeaders(sb: SupabaseClient): Promise<ProjectHeader[]> {
  const rows: ProjectHeader[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('pa_projects')
      .select('project, client, manager, status')
      .eq('row_kind', 'project')
      .order('project', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as ProjectHeader[]));
    if (data.length < 1000) break;
  }
  return rows;
}

async function loadStoredOffset(sb: SupabaseClient): Promise<number> {
  const { data, error } = await sb
    .from('pa_bqe_connection')
    .select('schedule_core_sync_offset')
    .eq('id', 1)
    .maybeSingle();
  if (error) return 0;
  const n = Number(data?.schedule_core_sync_offset);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

async function saveStoredOffset(sb: SupabaseClient, offset: number): Promise<void> {
  const { error } = await sb
    .from('pa_bqe_connection')
    .update({
      schedule_core_sync_offset: Math.max(0, Math.floor(offset)),
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
  if (error && !/schedule_core_sync_offset|column/i.test(error.message)) {
    throw new Error(error.message);
  }
}

async function ensureScheduleForProject(
  sb: SupabaseClient,
  header: ProjectHeader,
): Promise<{ id: string } | { error: string }> {
  const projectKey = header.project.trim();
  const { data: existing, error: findErr } = await sb
    .from('pa_schedules')
    .select('id')
    .eq('project_key', projectKey)
    .maybeSingle();
  if (findErr) return { error: findErr.message };
  if (existing?.id) return { id: existing.id as string };

  const { data, error } = await sb
    .from('pa_schedules')
    .insert({
      project_key: projectKey,
      client_name: (header.client || '').trim() || 'Unassigned',
      title: `Project Schedule — ${projectKey}`,
    })
    .select('id')
    .single();
  if (error) {
    if (/duplicate|unique|already exists/i.test(error.message)) {
      const again = await sb
        .from('pa_schedules')
        .select('id')
        .eq('project_key', projectKey)
        .maybeSingle();
      if (again.data?.id) return { id: again.data.id as string };
    }
    return { error: error.message };
  }
  if (!data?.id) return { error: 'Schedule insert returned no id' };
  return { id: data.id as string };
}

function defaultDeadlineMs(): number {
  const onVercel = process.env.VERCEL === '1';
  const budget = onVercel ? 8_500 : 280_000;
  return Date.now() + budget;
}

function defaultMaxProjects(): number {
  return process.env.VERCEL === '1' ? 2 : 0;
}

/** Chunked batch: align project schedules with CORE phases (safe on Vercel Hobby). */
export async function syncAllSchedulesFromCore(
  sb: SupabaseClient,
  opts?: SyncOpts,
): Promise<SyncAllSchedulesResult> {
  const activeOnly = opts?.activeOnly !== false;
  let headers = await fetchAllProjectHeaders(sb);
  if (activeOnly) {
    headers = headers.filter((h) => String(h.status || '').toUpperCase() === 'ACTIVE');
  }

  const total = headers.length;
  let startIndex = Math.max(0, Math.floor(Number(opts?.startIndex) || 0));
  if (opts?.resetStoredOffset) {
    startIndex = 0;
  } else if (opts?.startIndex == null && opts?.persistOffset) {
    startIndex = await loadStoredOffset(sb);
  }
  if (startIndex >= total) {
    startIndex = 0;
  }

  const deadlineMs = opts?.deadlineMs ?? defaultDeadlineMs();
  const maxProjects = Math.max(0, Math.floor(Number(opts?.maxProjects) || defaultMaxProjects()));

  const errors: string[] = [];
  let synced = 0;
  let skippedNoPhases = 0;
  let processed = 0;

  for (let i = startIndex; i < total; i++) {
    if (Date.now() >= deadlineMs) break;
    if (maxProjects > 0 && processed >= maxProjects) break;

    const header = headers[i]!;
    const projectKey = header.project.trim();
    if (!projectKey) continue;

    if (typeof process !== 'undefined' && process.stdout?.write) {
      process.stdout.write(`[${i + 1}/${total}] ${projectKey.slice(0, 60)}…\n`);
    }

    const corePhases = await loadCorePhases(projectKey, sb);
    if (!corePhases.length) {
      skippedNoPhases += 1;
      processed += 1;
      continue;
    }

    const sched = await ensureScheduleForProject(sb, header);
    if ('error' in sched) {
      errors.push(`${projectKey}: ${sched.error}`);
      processed += 1;
      continue;
    }

    const codeMatch = projectKey.match(/\b(\d{2}-\d{3})\b/);
    const res = await resyncProjectScheduleFromCore(
      {
        projectKey,
        scheduleId: sched.id,
        headerManager: header.manager,
        projectTitle: projectKey,
        projectCode: codeMatch ? codeMatch[1]! : null,
        clientName: (header.client || '').trim() || '',
        syncTimeMembers: false,
      },
      sb,
    );

    if (!res.ok) {
      errors.push(`${projectKey}: ${res.error}`);
    } else {
      synced += 1;
    }
    processed += 1;
  }

  const nextIndex = startIndex + processed;
  const hasMore = nextIndex < total;
  const storedNext = hasMore ? nextIndex : 0;

  if (opts?.persistOffset) {
    await saveStoredOffset(sb, storedNext);
  }

  return {
    ok: true,
    projects: total,
    synced,
    skippedNoPhases,
    errors,
    startIndex,
    nextIndex: storedNext,
    hasMore,
  };
}
