import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyEmployeeTaskScope, isTaskAssignedToEmployee } from './employeeTaskScope';

describe('employeeTaskScope', () => {
  it('filters to assignee when scope is assigned', () => {
    const tasks = [
      { assigneeName: 'Ada Lovelace', task: 'A' },
      { assigneeName: 'Bob', task: 'B' },
      { assigneeName: 'ada lovelace', task: 'C' },
    ];
    const out = applyEmployeeTaskScope(tasks, 'Ada Lovelace', 'assigned');
    assert.equal(out.length, 2);
    assert.ok(isTaskAssignedToEmployee(tasks[0]!, 'Ada Lovelace'));
  });

  it('shows full list for project leads regardless of scope', () => {
    const tasks = [{ assigneeName: 'Bob', task: 'B' }];
    const out = applyEmployeeTaskScope(tasks, 'Ada', 'assigned', { isLead: true });
    assert.equal(out.length, 1);
  });
});
