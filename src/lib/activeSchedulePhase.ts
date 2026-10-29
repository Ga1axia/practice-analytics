import { matchProcessPhaseIndex } from './architecturalProcess';
import { employeeIdentityKey } from './employeeRoster';
import { isActiveProjectStatus } from './projectStatus';
import { parseDeterministicQuery } from './textSearch';

export type SchedulePhaseSource = {
  label: string;
  row: { status?: string | null; phase?: string | null };
};

function normLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function labelsAlign(scheduleTitle: string, coreLabel: string): boolean {
  const title = normLabel(scheduleTitle);
  const label = normLabel(coreLabel);
  if (!title || !label) return false;
  if (title === label) return true;

  const titleIdx = matchProcessPhaseIndex(scheduleTitle);
  const labelIdx = matchProcessPhaseIndex(coreLabel);
  const titleInterior = title.includes('interior');
  const labelInterior = label.includes('interior');
  if (titleIdx >= 0 && titleIdx === labelIdx && titleInterior === labelInterior) return true;

  const shorter = title.length <= label.length ? title : label;
  const longer = title.length <= label.length ? label : title;
  return shorter.length >= 8 && longer.includes(shorter);
}

/** True when this schedule phase matches a CORE phase whose status is Active. */
export function isExplicitlyActiveSchedulePhase(
  project: { phases?: SchedulePhaseSource[] },
  schedulePhaseTitle: string,
): boolean {
  const title = schedulePhaseTitle.trim();
  if (!title) return false;
  for (const ph of project.phases || []) {
    if (!isActiveProjectStatus(ph.row.status)) continue;
    const label = (ph.label || ph.row.phase || '').trim();
    if (label && labelsAlign(title, label)) return true;
  }
  return false;
}

export function taskMatchesScheduleSearch(
  task: {
    task: string;
    projectTitle: string;
    clientName: string;
    phase: string;
    phaseManagerName: string;
    assigneeName: string;
    priority?: string;
    statusLabel?: string;
  },
  rawQuery: string,
): boolean {
  const query = rawQuery.trim();
  if (!query) return true;
  const { phrases, tokens } = parseDeterministicQuery(query);
  const parts = [...phrases, ...tokens];
  if (!parts.length) return true;

  const haystack = [
    task.task,
    task.projectTitle,
    task.clientName,
    task.phase,
    task.phaseManagerName,
    task.assigneeName,
    task.priority || '',
    task.statusLabel || '',
  ]
    .join(' ')
    .toLowerCase();
  const nameKeys = [task.assigneeName, task.phaseManagerName, task.clientName, task.projectTitle]
    .map((name) => employeeIdentityKey(name))
    .filter((key) => key.length >= 3);

  return parts.every((part) => {
    if (haystack.includes(part.toLowerCase())) return true;
    const partKey = employeeIdentityKey(part);
    if (partKey.length < 3) return false;
    return nameKeys.some((key) => key.includes(partKey));
  });
}
