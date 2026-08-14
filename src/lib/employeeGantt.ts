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
  rowId: string;
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
        autoSeed: false,
        autoDate: false,
      });
      if (res.error) errors.push(`${p.title}: ${res.error}`);
      if (!res.rows.length) return;

      const projectBars = buildGanttBars(res.rows, 'all');
      for (const b of projectBars) {
        bars.push({
          ...b,
          id: `${p.key}:${b.id}`,
          rowId: b.id,
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

/** One swimlane per phase — segments are dated tasks/subtasks (phase rollup if nothing else). */
export type EmployeeGanttPhaseRow = {
  id: string;
  projectKey: string;
  projectTitle: string;
  clientName: string;
  phaseTitle: string;
  start: Date;
  end: Date;
  segments: EmployeeGanttBar[];
};

function phaseTitleOf(bar: EmployeeGanttBar): string {
  const prefix = `${bar.projectTitle} · `;
  if (bar.section.startsWith(prefix)) return bar.section.slice(prefix.length);
  if (bar.kind === 'phase') {
    if (bar.label.startsWith(prefix)) return bar.label.slice(prefix.length);
    return bar.label;
  }
  return bar.section || 'Phase';
}

export function groupEmployeeGanttByPhase(
  bars: EmployeeGanttBar[],
): EmployeeGanttPhaseRow[] {
  const map = new Map<string, EmployeeGanttBar[]>();
  for (const b of bars) {
    const key = `${b.projectKey}::${phaseTitleOf(b)}`;
    const list = map.get(key) || [];
    list.push(b);
    map.set(key, list);
  }

  const rows: EmployeeGanttPhaseRow[] = [];
  for (const [id, list] of map) {
    const first = list[0]!;
    const hasWork = list.some((b) => b.kind !== 'phase');
    const segments = (hasWork ? list.filter((b) => b.kind !== 'phase') : list)
      .slice()
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    if (!segments.length) continue;
    let start = segments[0]!.start;
    let end = segments[0]!.end;
    for (const s of segments) {
      if (s.start.getTime() < start.getTime()) start = s.start;
      if (s.end.getTime() > end.getTime()) end = s.end;
    }
    rows.push({
      id,
      projectKey: first.projectKey,
      projectTitle: first.projectTitle,
      clientName: first.clientName,
      phaseTitle: phaseTitleOf(first),
      start,
      end,
      segments,
    });
  }

  rows.sort((a, b) => {
    const pc = a.projectTitle.localeCompare(b.projectTitle, undefined, { sensitivity: 'base' });
    if (pc !== 0) return pc;
    return a.start.getTime() - b.start.getTime();
  });
  return rows;
}

/** True when a span overlaps [rangeStart, rangeEnd] (inclusive days). */
export function rangeIntersects(
  start: Date,
  end: Date,
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  return start.getTime() <= rangeEnd.getTime() && end.getTime() >= rangeStart.getTime();
}

export { ganttTimelineBounds };
