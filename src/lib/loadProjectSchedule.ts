import { supabase } from './supabase';
import type { ScheduleMeta, ScheduleRow } from './scheduleTypes';

export async function loadProjectSchedule(projectKey: string): Promise<{
  meta: ScheduleMeta | null;
  rows: ScheduleRow[];
  error: string | null;
}> {
  const { data: scheds, error: sErr } = await supabase
    .from('pa_schedules')
    .select('id, project_key, client_name, title')
    .order('project_key');
  if (sErr) return { meta: null, rows: [], error: sErr.message };

  const list = (scheds || []) as ScheduleMeta[];
  const needle = projectKey.toLowerCase();
  const hit =
    list.find((s) => s.project_key === projectKey) ||
    list.find((s) => {
      const k = s.project_key.toLowerCase();
      return k.includes(needle) || needle.includes(k);
    }) ||
    null;

  if (!hit) return { meta: null, rows: [], error: null };

  const { data, error: rErr } = await supabase
    .from('pa_schedule_rows')
    .select('*')
    .eq('schedule_id', hit.id)
    .order('sort_order');

  if (rErr) return { meta: hit, rows: [], error: rErr.message };
  return { meta: hit, rows: (data || []) as ScheduleRow[], error: null };
}

const DOC_HINT =
  /document|package|deliverable|drawing|plan|elevation|submittal|report|permit|spec|board|set\b/i;

/** Schedule tasks that look like document/deliverable work, plus any open dated items. */
export function scheduleDeliverables(rows: ScheduleRow[]) {
  let section = 'Project';
  const out: {
    id: string;
    section: string;
    task: string;
    kind: string;
    status: string;
    targetStart: string;
    targetEnd: string;
    isDocument: boolean;
  }[] = [];

  for (const row of rows) {
    if (row.row_kind === 'phase') {
      section = row.task || 'Phase';
      continue;
    }
    if (row.row_kind !== 'task' && row.row_kind !== 'subtask') continue;
    const task = (row.task || '').trim();
    if (!task) continue;
    const status = (row.budget_remaining || '').trim();
    const isDocument = DOC_HINT.test(task);
    const open = !/^(completed|n\/a|na|done|not\s*applicable)/i.test(status);
    if (!isDocument && !open) continue;
    out.push({
      id: row.id,
      section,
      task,
      kind: row.row_kind,
      status: status || '—',
      targetStart: (row.target_start || '').trim() || '—',
      targetEnd: (row.target_end || '').trim() || '—',
      isDocument,
    });
  }
  return out;
}
