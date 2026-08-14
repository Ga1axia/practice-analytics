import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cascadeRowsAfterEndEdit } from './scheduleCascade';
import type { ScheduleRow } from './scheduleTypes';

function row(
  partial: Partial<ScheduleRow> & Pick<ScheduleRow, 'id' | 'sort_order' | 'task'>,
): ScheduleRow {
  return {
    schedule_id: 's',
    row_kind: 'task',
    budget_remaining: 'Active',
    target_start: '',
    target_end: '',
    actual_start: '',
    actual_end: '',
    action: '',
    estimate_time: '',
    mdesigns_comments: '',
    client_comments: '',
    assignee_name: '',
    ...partial,
  };
}

describe('cascadeRowsAfterEndEdit', () => {
  it('shifts later tasks by the same day delta when an end date moves', () => {
    const rows = [
      row({
        id: 'a',
        sort_order: 0,
        task: 'First',
        target_start: '1/1/2026',
        target_end: '1/5/2026',
      }),
      row({
        id: 'b',
        sort_order: 1,
        task: 'Second',
        target_start: '1/6/2026',
        target_end: '1/10/2026',
      }),
      row({
        id: 'c',
        sort_order: 2,
        task: 'Third',
        target_start: '1/11/2026',
        target_end: '1/15/2026',
      }),
    ];

    // Move first task end +3 days (1/5 → 1/8)
    const next = cascadeRowsAfterEndEdit(rows, 'a', '1/8/2026');
    assert.equal(next[0]!.target_end, '1/8/2026');
    assert.equal(next[0]!.target_start, '1/1/2026'); // edited row start unchanged
    assert.equal(next[1]!.target_start, '1/9/2026');
    assert.equal(next[1]!.target_end, '1/13/2026');
    assert.equal(next[2]!.target_start, '1/14/2026');
    assert.equal(next[2]!.target_end, '1/18/2026');
  });

  it('does not move earlier tasks', () => {
    const rows = [
      row({
        id: 'a',
        sort_order: 0,
        task: 'First',
        target_start: '1/1/2026',
        target_end: '1/5/2026',
      }),
      row({
        id: 'b',
        sort_order: 1,
        task: 'Second',
        target_start: '1/6/2026',
        target_end: '1/10/2026',
      }),
    ];
    const next = cascadeRowsAfterEndEdit(rows, 'b', '1/12/2026');
    assert.equal(next[0]!.target_end, '1/5/2026');
    assert.equal(next[1]!.target_end, '1/12/2026');
    assert.equal(next[1]!.target_start, '1/6/2026');
  });
});
