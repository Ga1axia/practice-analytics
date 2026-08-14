import type { EnsureScheduleResult } from './scheduleEnsure';
import type { ScheduleRow } from './scheduleTypes';

type CacheEntry = {
  result: EnsureScheduleResult;
  at: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<EnsureScheduleResult>>();

export function getCachedSchedule(projectKey: string): EnsureScheduleResult | null {
  return cache.get(projectKey)?.result || null;
}

export function setCachedSchedule(result: EnsureScheduleResult) {
  cache.set(result.projectKey, { result, at: Date.now() });
}

export function getInflightSchedule(projectKey: string) {
  return inflight.get(projectKey) || null;
}

export function setInflightSchedule(projectKey: string, promise: Promise<EnsureScheduleResult>) {
  inflight.set(projectKey, promise);
}

export function clearInflightSchedule(projectKey: string) {
  inflight.delete(projectKey);
}

/** Update a single row in the cached schedule (e.g. after checkmark). */
export function patchCachedScheduleRow(
  projectKey: string,
  rowId: string,
  patch: Partial<
    Pick<
      ScheduleRow,
      | 'task'
      | 'budget_remaining'
      | 'actual_end'
      | 'actual_start'
      | 'target_start'
      | 'target_end'
      | 'sort_order'
      | 'row_kind'
      | 'assignee_name'
      | 'action'
      | 'mdesigns_comments'
      | 'client_comments'
    >
  >,
): boolean {
  const entry = cache.get(projectKey);
  if (!entry) return false;
  const rows = entry.result.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r));
  cache.set(projectKey, {
    at: Date.now(),
    result: { ...entry.result, rows },
  });
  return true;
}

export function invalidateScheduleCache(projectKey?: string) {
  if (projectKey) {
    cache.delete(projectKey);
    inflight.delete(projectKey);
    return;
  }
  cache.clear();
  inflight.clear();
}
