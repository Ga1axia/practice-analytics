import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCorePhases } from '../../src/lib/scheduleCorePhases.js';
import { resyncProjectScheduleFromCore } from '../../src/lib/scheduleCoreResync.js';

export type SyncAllSchedulesResult = {
  ok: true;
  projects: number;
  synced: number;
  skippedNoPhases: number;
  errors: string[];
};

type ProjectHeader = {
  project: string;
  client: string | null;
  manager: string | null;
  status: string | null;
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

/** Daily batch: align every project schedule with CORE phases, checklist gaps, and leads. */
export async function syncAllSchedulesFromCore(
  sb: SupabaseClient,
  opts?: { activeOnly?: boolean },
): Promise<SyncAllSchedulesResult> {
  const activeOnly = opts?.activeOnly !== false;
  let headers = await fetchAllProjectHeaders(sb);
  if (activeOnly) {
    headers = headers.filter((h) => String(h.status || '').toUpperCase() === 'ACTIVE');
  }

  const errors: string[] = [];
  let synced = 0;
  let skippedNoPhases = 0;

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]!;
    const projectKey = header.project.trim();
    if (!projectKey) continue;
    if (typeof process !== 'undefined' && process.stdout?.write) {
      process.stdout.write(`[${i + 1}/${headers.length}] ${projectKey.slice(0, 60)}…\n`);
    }

    const corePhases = await loadCorePhases(projectKey, sb);
    if (!corePhases.length) {
      skippedNoPhases += 1;
      continue;
    }

    const sched = await ensureScheduleForProject(sb, header);
    if ('error' in sched) {
      errors.push(`${projectKey}: ${sched.error}`);
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
      continue;
    }
    synced += 1;
  }

  return {
    ok: true,
    projects: headers.length,
    synced,
    skippedNoPhases,
    errors,
  };
}
