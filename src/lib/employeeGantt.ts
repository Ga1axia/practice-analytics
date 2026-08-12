import { ensureProjectSchedule } from './scheduleEnsure';
import {
  buildGanttBars,
  ganttTimelineBounds,
  type GanttBar,
  type GanttFilter,
} from './scheduleGantt';
import type { ProjectNode } from './projectListHierarchy';

export type EmployeeGanttBar = GanttBar & {
  projectKey: string;
  projectTitle: string;
  clientName: string;
};

/** Load schedules once (cached) and build Gantt bars for all kinds. Filter client-side. */
export async function loadEmployeeGantt(
  projects: (ProjectNode & { clientName: string })[],
  opts?: { limit?: number },
): Promise<{ bars: EmployeeGanttBar[]; errors: string[] }> {
  const slice = projects.slice(0, opts?.limit ?? 40);
  const bars: EmployeeGanttBar[] = [];
  const errors: string[] = [];

  await Promise.all(
    slice.map(async (p) => {
      const res = await ensureProjectSchedule({
        projectKey: p.key,
        clientName: p.clientName,
        title: p.title,
      });
      if (res.error) errors.push(`${p.title}: ${res.error}`);
      if (!res.rows.length) return;

      const projectBars = buildGanttBars(res.rows, 'all');
      for (const b of projectBars) {
        bars.push({
          ...b,
          id: `${p.key}:${b.id}`,
          label: b.kind === 'phase' ? `${p.title} · ${b.label}` : b.label,
          section: `${p.title} · ${b.section}`,
          projectKey: p.key,
          projectTitle: p.title,
          clientName: p.clientName,
        });
      }
    }),
  );

  bars.sort((a, b) => {
    const pc = a.projectTitle.localeCompare(b.projectTitle, undefined, { sensitivity: 'base' });
    if (pc !== 0) return pc;
    return a.start.getTime() - b.start.getTime();
  });

  return { bars, errors };
}

export function filterEmployeeGanttBars(
  bars: EmployeeGanttBar[],
  opts: { kind?: GanttFilter; projectKey?: string },
): EmployeeGanttBar[] {
  let list = bars;
  if (opts.projectKey) list = list.filter((b) => b.projectKey === opts.projectKey);
  const kind = opts.kind || 'all';
  if (kind === 'tasks') list = list.filter((b) => b.kind === 'task' || b.kind === 'phase');
  else if (kind === 'subtasks') list = list.filter((b) => b.kind === 'subtask');
  else if (kind === 'deadlines') list = list.filter((b) => b.milestone);
  return list;
}

export { ganttTimelineBounds };
