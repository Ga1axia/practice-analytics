import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isProjectListManager } from './projectManagerMatch';

describe('isProjectListManager', () => {
  it('matches manager names case-insensitively with trimmed whitespace', () => {
    const project = {
      row: { manager: '  Avery Cobe  ' },
      phases: [{ row: { manager: 'Ni Ni' } }],
    };
    assert.equal(isProjectListManager(project, 'avery cobe'), true);
    assert.equal(isProjectListManager(project, 'Avery Cobe'), true);
    assert.equal(isProjectListManager(project, 'Nobody'), false);
  });

  it('matches phase managers', () => {
    const project = {
      row: { manager: 'Lead' },
      phases: [{ row: { manager: 'Phase PM' } }],
    };
    assert.equal(isProjectListManager(project, 'Phase PM'), true);
    assert.equal(isProjectListManager(project, 'phase pm'), true);
  });
});
