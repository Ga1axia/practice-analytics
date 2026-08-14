import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isAutofilledAction,
  isPresetStructureAction,
  PRESET_PHASE_DAYS,
} from './scheduleAutofill';
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
      assert.ok(isAutofilledAction(p.action));
    }
    const datedWork = rows.filter(
      (r) => (r.row_kind === 'task' || r.row_kind === 'subtask') && r.budget_remaining !== 'N/A',
    );
    assert.ok(datedWork.every((r) => r.target_end.includes('/')));
    assert.ok(datedWork.every((r) => isAutofilledAction(r.action)));
    const ve = rows.find((r) => /value engineering/i.test(r.task));
    assert.ok(ve);
    assert.equal(ve!.row_kind, 'task');
    assert.ok(!phases.some((p) => /value engineering/i.test(p.task)));
    const interior = phases.find((p) => /interior design/i.test(p.task));
    assert.ok(interior);
    assert.equal(interior!.task, 'Interior Design');
  });

  it('seeds Interior checklist without target dates', () => {
    const rows = buildDatedScheduleRows(new Date(2026, 0, 5), { preset: 'interior' });
    const work = rows.filter((r) => r.budget_remaining !== 'N/A');
    assert.ok(work.length > 0);
    assert.ok(work.every((r) => !r.target_start && !r.target_end));
    assert.ok(work.every((r) => isPresetStructureAction(r.action)));
  });

  it('uses remodel preset phase gaps', () => {
    const kickoff = new Date(2026, 0, 5);
    const remodel = buildDatedScheduleRows(kickoff, { preset: 'remodel' });
    const neo = buildDatedScheduleRows(kickoff, { preset: 'new_residence' });
    const remodelPre = remodel.find((r) => r.row_kind === 'phase' && /pre-design/i.test(r.task));
    const neoPre = neo.find((r) => r.row_kind === 'phase' && /pre-design/i.test(r.task));
    assert.ok(remodelPre && neoPre);
    assert.notEqual(remodelPre!.target_end, neoPre!.target_end);
    assert.equal(PRESET_PHASE_DAYS.remodel['pre-design'], 21);
    assert.equal(PRESET_PHASE_DAYS.new_residence['pre-design'], 28);
  });

  it('fills only undated open rows and marks autofill', () => {
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
        assignee_name: '',
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
        assignee_name: '',
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
        assignee_name: '',
      },
    ];
    const updates = proposeMissingDates(rows, new Date(2026, 2, 1));
    assert.equal(updates.length, 2);
    assert.ok(updates.every((u) => u.id !== 't2'));
    assert.ok(updates.every((u) => isAutofilledAction(u.action)));
  });
});
