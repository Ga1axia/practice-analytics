import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { displayPhaseTitle, groupScheduleSections, isScheduleSubphaseTitle } from './scheduleSections';
import type { ScheduleRow, ScheduleRowKind } from './scheduleTypes';

function row(
  sort: number,
  kind: ScheduleRowKind,
  task: string,
  id = `r${sort}`,
): ScheduleRow {
  return {
    id,
    schedule_id: 's',
    sort_order: sort,
    row_kind: kind,
    task,
    budget_remaining: '',
    target_start: '',
    target_end: '',
    actual_start: '',
    actual_end: '',
    action: '',
    estimate_time: '',
    mdesigns_comments: '',
    client_comments: '',
    assignee_name: '',
  };
}

describe('groupScheduleSections', () => {
  it('keeps Value Engineering under Contractor Selection even if stored as a phase', () => {
    const sections = groupScheduleSections([
      row(0, 'phase', 'Contractor Selection'),
      row(1, 'task', 'Contractor selected'),
      row(
        2,
        'phase',
        'Value Engineering if any (Add 1-4 weeks to time depending on the scope of changes)',
      ),
      row(3, 'subtask', 'Contractor feedback'),
      row(4, 'subtask', 'Drawing adjustments'),
      row(5, 'phase', 'Design Development'),
      row(6, 'task', 'Design Development Started'),
    ]);

    assert.equal(sections.length, 2);
    assert.equal(sections[0]!.title, 'Contractor Selection');
    assert.deepEqual(
      sections[0]!.items.map((r) => r.task),
      [
        'Contractor selected',
        'Value Engineering if any (Add 1-4 weeks to time depending on the scope of changes)',
        'Contractor feedback',
        'Drawing adjustments',
      ],
    );
    assert.equal(sections[0]!.items[1]!.row_kind, 'task');
    assert.equal(sections[1]!.title, 'Design Development');
  });

  it('leaves a correctly typed Value Engineering task inside Contractor Selection', () => {
    const sections = groupScheduleSections([
      row(0, 'phase', 'Contractor Selection'),
      row(1, 'task', 'Value Engineering if any'),
      row(2, 'subtask', 'Contractor feedback'),
    ]);
    assert.equal(sections.length, 1);
    assert.equal(sections[0]!.items.length, 2);
    assert.equal(sections[0]!.items[0]!.row_kind, 'task');
  });
});

describe('isScheduleSubphaseTitle', () => {
  it('matches value engineering titles only', () => {
    assert.equal(isScheduleSubphaseTitle('Value Engineering if any'), true);
    assert.equal(isScheduleSubphaseTitle('Contractor Selection'), false);
    assert.equal(isScheduleSubphaseTitle('Design Development'), false);
  });
});

describe('displayPhaseTitle', () => {
  it('drops the Interior Design spreadsheet note', () => {
    assert.equal(
      displayPhaseTitle(
        'Interior Design (Schedule more defined once scope and timing of when we are starting is defined)',
      ),
      'Interior Design',
    );
    assert.equal(displayPhaseTitle('Interior Design'), 'Interior Design');
    assert.equal(displayPhaseTitle('Pre-Design'), 'Pre-Design');
  });
});
