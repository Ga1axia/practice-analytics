import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isExplicitlyActiveSchedulePhase,
  taskMatchesScheduleSearch,
} from './activeSchedulePhase';

const phases = [
  { label: 'Conceptual/ Schematic Design', row: { status: 'ACTIVE', phase: 'Conceptual/ Schematic Design' } },
  { label: 'Interior Design', row: { status: 'ACTIVE', phase: 'Interior Design' } },
  { label: 'Design Development', row: { status: 'COMPLETED', phase: 'Design Development' } },
  { label: 'Reimbursable', row: { status: 'ACTIVE', phase: 'Reimbursable' } },
  { label: 'Construction Documents', row: { status: 'HOLD', phase: 'Construction Documents' } },
];

describe('isExplicitlyActiveSchedulePhase', () => {
  it('matches a schedule phase only when CORE marks that phase Active', () => {
    const project = { phases };
    assert.equal(isExplicitlyActiveSchedulePhase(project, 'Schematic Design'), true);
    assert.equal(isExplicitlyActiveSchedulePhase(project, 'Reimbursables'), true);
    assert.equal(isExplicitlyActiveSchedulePhase(project, 'Design Development'), false);
    assert.equal(isExplicitlyActiveSchedulePhase(project, 'Construction Documents'), false);
    assert.equal(isExplicitlyActiveSchedulePhase(project, 'Project kickoff'), false);
  });

  it('does not treat an active interior phase as design development', () => {
    assert.equal(
      isExplicitlyActiveSchedulePhase({ phases }, 'Design Development'),
      false,
    );
    assert.equal(isExplicitlyActiveSchedulePhase({ phases }, 'Interior Design Services'), true);
  });
});

describe('taskMatchesScheduleSearch', () => {
  const task = {
    task: 'Issue drawings',
    projectTitle: 'Branderiz, Eric & Maggie - 21-268',
    clientName: 'Eric Branderiz',
    phase: 'Schematic Design',
    phaseManagerName: 'Avery Cobe',
    assigneeName: 'Ni Ni',
    priority: 'Medium',
    statusLabel: 'Incomplete',
  };

  it('matches a person when the name is not one contiguous string', () => {
    assert.equal(taskMatchesScheduleSearch(task, 'eric branderiz'), true);
    assert.equal(taskMatchesScheduleSearch(task, 'Maggie'), true);
  });

  it('matches compacted roster spellings', () => {
    assert.equal(taskMatchesScheduleSearch(task, 'AveryCobe'), true);
    assert.equal(taskMatchesScheduleSearch(task, 'NiNi'), true);
    assert.equal(taskMatchesScheduleSearch(task, 'Someone Else'), false);
  });

  it('does not treat a project-name search as a match for every person named in it', () => {
    const other = {
      ...task,
      task: 'Site visit',
      projectTitle: 'Other House - 22-001',
      clientName: 'Other Client',
      phaseManagerName: 'Someone Else',
      assigneeName: 'Eric',
    };
    assert.equal(taskMatchesScheduleSearch(task, 'Branderiz Maggie'), true);
    assert.equal(taskMatchesScheduleSearch(other, 'Branderiz Maggie'), false);
  });
});
