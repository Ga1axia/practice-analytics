import {
  matchProcessPhaseIndex,
  PROCESS_PHASES,
  type ProcessPhaseId,
} from './architecturalProcess';
import { displayPhaseTitleClient, displayTaskTitle } from './clientCopy';
import type { DeadlineEvent } from './scheduleDates';
import { parseScheduleDate, startOfDay } from './scheduleDates';
import { groupScheduleSections, isSchedulePhaseRow, statusTone } from './scheduleSections';
import type { ScheduleRow } from './scheduleTypes';

const ALERT_DISMISS_KEY = 'pa-cp-alert-dismiss-v1';
const SEEN_KEY = 'pa-cp-seen-v1';
const REVIEW_KEY = 'pa-cp-doc-review-v1';
const DISMISS_DAYS = 7;

export type ClientAlert = {
  id: string;
  kind: 'overdue' | 'unread' | 'approval';
  title: string;
  detail: string;
  href?: string;
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function isAlertDismissed(projectKey: string, alertId: string): boolean {
  const map = loadJson<Record<string, string>>(`${ALERT_DISMISS_KEY}:${projectKey}`, {});
  const at = map[alertId];
  if (!at) return false;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

export function dismissAlert(projectKey: string, alertId: string) {
  const map = loadJson<Record<string, string>>(`${ALERT_DISMISS_KEY}:${projectKey}`, {});
  map[alertId] = new Date().toISOString();
  localStorage.setItem(`${ALERT_DISMISS_KEY}:${projectKey}`, JSON.stringify(map));
}

export function markPortalSeen(projectKey: string) {
  localStorage.setItem(`${SEEN_KEY}:${projectKey}`, new Date().toISOString());
}

export function portalSeenAt(projectKey: string): Date | null {
  const raw = localStorage.getItem(`${SEEN_KEY}:${projectKey}`);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type DocReview = { at: string; by: string };

export function documentReviews(projectKey: string): Record<string, DocReview> {
  return loadJson<Record<string, DocReview>>(`${REVIEW_KEY}:${projectKey}`, {});
}

export function markDocumentReviewed(projectKey: string, itemId: string, by: string): DocReview {
  const map = documentReviews(projectKey);
  const rec = { at: new Date().toISOString(), by };
  map[itemId] = rec;
  localStorage.setItem(`${REVIEW_KEY}:${projectKey}`, JSON.stringify(map));
  return rec;
}

export function urgencyClass(date: Date, today = startOfDay(new Date())): 'past' | 'week' | 'future' {
  const t = startOfDay(date).getTime();
  const now = today.getTime();
  if (t < now) return 'past';
  const week = now + 7 * 24 * 60 * 60 * 1000;
  if (t <= week) return 'week';
  return 'future';
}

export function downloadDeadlineIcs(events: DeadlineEvent[], projectTitle: string) {
  const ymd = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  };
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//M Designs//Client Portal//EN',
    'CALSCALE:GREGORIAN',
  ];
  for (const e of events) {
    const day = startOfDay(e.date);
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@mdesigns.client`,
      `DTSTART;VALUE=DATE:${ymd(day)}`,
      `DTEND;VALUE=DATE:${ymd(end)}`,
      `SUMMARY:${displayTaskTitle(e.task).replace(/[,\\;]/g, ' ')}`,
      `DESCRIPTION:${displayPhaseTitleClient(e.section)} — ${projectTitle}`.replace(/[,\\;]/g, ' '),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mdesigns-deadlines.ics';
  a.click();
  URL.revokeObjectURL(url);
}

export function phaseEndFromRows(rows: ScheduleRow[], phaseId: ProcessPhaseId): string | null {
  const sections = groupScheduleSections(rows);
  const hit = sections.find((s) => {
    const idx = matchProcessPhaseIndex(s.title);
    return idx >= 0 && PROCESS_PHASES[idx]?.id === phaseId;
  });
  const candidates = [
    hit?.phaseRow?.target_end,
    ...(hit?.items.map((r) => r.target_end) || []),
  ].filter((v): v is string => Boolean(v && parseScheduleDate(v)));
  const raw = candidates.sort((a, b) => {
    const da = parseScheduleDate(a)?.getTime() || 0;
    const db = parseScheduleDate(b)?.getTime() || 0;
    return db - da;
  })[0];
  if (!raw) return null;
  const d = parseScheduleDate(raw);
  return d
    ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : raw.trim();
}

export function mainStageCount() {
  return PROCESS_PHASES.filter((p) => p.id !== 'additional').length;
}

export function stageProgressPct(currentIdx: number): number {
  const n = mainStageCount();
  if (currentIdx < 0) return 0;
  if (PROCESS_PHASES[currentIdx]?.id === 'additional') {
    return Math.round(((n - 1) / n) * 100);
  }
  return Math.round((Math.min(currentIdx, n) / n) * 100);
}

export function needsClientReply(row: ScheduleRow): boolean {
  const firm = row.mdesigns_comments.trim();
  const client = row.client_comments.trim();
  if (firm && !client) return true;
  const tone = statusTone(row.budget_remaining);
  return tone === 'active' && /client|you|approval|decision/i.test(row.task);
}

/** Prefer an active child/schedule phase over a header catchall like Other / Additional Services. */
export function inferCurrentPhase(
  headerPhase: string | null | undefined,
  childPhases: (string | null | undefined)[],
): string | null {
  const headerIdx = matchProcessPhaseIndex(headerPhase);
  const catchall =
    !headerPhase?.trim() ||
    /^other$/i.test(headerPhase.trim()) ||
    PROCESS_PHASES[headerIdx]?.id === 'additional';
  if (!catchall && headerIdx >= 0) return headerPhase?.trim() || null;

  let best = -1;
  let bestLabel: string | null = headerPhase?.trim() || null;
  for (const raw of childPhases) {
    const p = (raw || '').trim();
    if (!p) continue;
    const idx = matchProcessPhaseIndex(p);
    if (idx < 0) continue;
    if (PROCESS_PHASES[idx]?.id === 'additional') continue;
    if (idx > best) {
      best = idx;
      bestLabel = p;
    }
  }
  return bestLabel;
}

export function milestoneHealth(
  overdueCount: number,
  needsCount: number,
): 'On Track' | 'At Risk' | 'Blocked' {
  if (needsCount > 0 && overdueCount > 0) return 'Blocked';
  if (overdueCount > 0 || needsCount > 2) return 'At Risk';
  return 'On Track';
}

export function clientDeliverables(rows: ScheduleRow[]) {
  let section = 'Project';
  const out: {
    id: string;
    section: string;
    task: string;
    status: string;
    date: string;
    kind: string;
  }[] = [];
  const hint =
    /document|package|deliverable|drawing|plan|elevation|submittal|report|permit|spec|board|set\b|render/i;
  for (const row of rows) {
    if (isSchedulePhaseRow(row)) {
      section = displayPhaseTitleClient(row.task || 'Phase');
      continue;
    }
    if (row.row_kind !== 'task' && row.row_kind !== 'subtask') continue;
    const task = displayTaskTitle(row.task || '');
    if (!task || !hint.test(task)) continue;
    out.push({
      id: row.id,
      section,
      task,
      status: row.budget_remaining || '—',
      date: (row.target_end || row.target_start || row.actual_end || '').trim(),
      kind: row.row_kind,
    });
  }
  return out;
}
