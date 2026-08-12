import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDatedScheduleRows, proposeMissingDates } from './scheduleDating';
import type { ScheduleRow } from './scheduleTypes';

describe('schedule ensure dating', () => {
  it('dates every phase and non-N/A task from kickoff', () => {
    const kickoff = new Date(2026, 0, 5);
    const rows = buildDatedScheduleRows(kickoff);
    assert.ok(rows.length >= 80);
    const phases = rows.filter((r) => r.row_kind === 'phase');
    assert.ok(phases.length >= 8);
    for (const p of phases) {
      assert.match(p.target_start, /\d+\/\d+\/\d+/);
      assert.match(p.target_end, /\d+\/\d+\/\d+/);
    }
    const datedWork = rows.filter(
      (r) => (r.row_kind === 'task' || r.row_kind === 'subtask') && r.budget_remaining !== 'N/A',
    );
    assert.ok(datedWork.every((r) => r.target_end.includes('/')));
  });

  it('fills only undated open rows', () => {
    const rows: ScheduleRow[] = [
      {
        id: 'p1',
        schedule_id: 's',
        sort_order: 0,
        row_kind: 'phase',
        task: 'Pre-Design',
        budget_remaining: 'Active',
        target_start: '',
        target_end: '',
        actual_start: '',
        actual_end: '',
        action: '',
        estimate_time: '',
        mdesigns_comments: '',
        client_comments: '',
      },
      {
        id: 't1',
        schedule_id: 's',
        sort_order: 1,
        row_kind: 'task',
        task: 'Programming',
        budget_remaining: 'Active',
        target_start: '',
        target_end: '',
        actual_start: '',
        actual_end: '',
        action: '',
        estimate_time: '',
        mdesigns_comments: '',
        client_comments: '',
      },
      {
        id: 't2',
        schedule_id: 's',
        sort_order: 2,
        row_kind: 'task',
        task: 'Done item',
        budget_remaining: 'Completed',
        target_start: '',
        target_end: '',
        actual_start: '',
        actual_end: '',
        action: '',
        estimate_time: '',
        mdesigns_comments: '',
        client_comments: '',
      },
    ];
    const updates = proposeMissingDates(rows, new Date(2026, 2, 1));
    assert.equal(updates.length, 2);
    assert.ok(updates.every((u) => u.id !== 't2'));
  });
});
