import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDatedScheduleRows } from './scheduleDating';
import { buildResyncedScheduleRows } from './scheduleCoreResyncMerge';
import type { ScheduleRow } from './scheduleTypes';

function row(partial: Partial<ScheduleRow> & Pick<ScheduleRow, 'sort_order' | 'row_kind' | 'task'>): ScheduleRow {
  return {
    id: partial.id ?? `id-${partial.sort_order}`,
    schedule_id: 'sched-1',
    budget_remaining: partial.budget_remaining ?? 'Active',
    target_start: partial.target_start ?? '',
    target_end: partial.target_end ?? '',
    actual_start: partial.actual_start ?? '',
    actual_end: partial.actual_end ?? '',
    action: partial.action ?? '',
    estimate_time: partial.estimate_time ?? '',
    mdesigns_comments: partial.mdesigns_comments ?? '',
    client_comments: partial.client_comments ?? '',
    assignee_name: partial.assignee_name ?? '',
    ...partial,
  };
}

describe('scheduleCoreResync', () => {
  it('renames phases to CORE titles and adds missing template tasks', () => {
    const existing: ScheduleRow[] = [
      row({ sort_order: 0, row_kind: 'phase', task: 'Pre-Design', id: 'ph1' }),
      row({ sort_order: 1, row_kind: 'task', task: 'Custom task', id: 't0' }),
    ];
    const corePhases = [
      { title: 'Pre-Design Services', manager: 'Alex PM', sortOrder: 0 },
      { title: 'Schematic Design', manager: 'Blake Lead', sortOrder: 1 },
    ];
    const templateDrafts = buildDatedScheduleRows(new Date(2026, 0, 5), {
      corePhaseTitles: corePhases.map((p) => p.title),
      includeDates: false,
    });
    const { rows, stats } = buildResyncedScheduleRows({
      scheduleId: 'sched-1',
      existing,
      corePhases,
      templateDrafts,
    });
    assert.equal(rows[0]?.task, 'Pre-Design Services');
    assert.match(rows[0]?.mdesigns_comments || '', /pa-phase-meta:/);
    assert.ok(rows.some((r) => r.task === 'Custom task'));
    assert.ok(stats.tasksAdded > 0);
    assert.ok(rows.some((r) => /program/i.test(r.task)));
  });
});
