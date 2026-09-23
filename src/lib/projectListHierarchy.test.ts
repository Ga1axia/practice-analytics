import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clientHasActiveProject,
  clientNamesWithActiveProjects,
  isActiveProjectNode,
  type ClientNode,
  type ProjectNode,
} from './projectListHierarchy';
import type { ProjectRow } from './types';

function proj(
  key: string,
  status: string,
  phases: ProjectRow[] = [],
): ProjectNode {
  return {
    key,
    title: key,
    code: null,
    row: {
      project: key,
      client: 'Acme',
      city: null,
      manager: null,
      status,
      type: null,
      phase: 'Other',
      contract: 0,
      spent: 0,
      billed: 0,
      pct_used: null,
      pct_billed: null,
      retainer_paid: 0,
      retainer_balance: 0,
      ar: 0,
      profit: 0,
      margin: null,
      row_kind: 'project',
      parent_project: null,
    },
    phases: phases.map((row) => ({ row, label: row.phase || 'Phase' })),
    contract: 0,
    billed: 0,
    outstanding: 0,
    billedHours: 0,
    spentHours: 0,
  };
}

describe('isActiveProjectNode', () => {
  it('uses project header status when present (ignores stray active phases)', () => {
    const phaseRow: ProjectRow = {
      project: 'Job - SD',
      client: 'Acme',
      city: null,
      manager: null,
      status: 'ACTIVE',
      type: null,
      phase: 'SD',
      contract: 0,
      spent: 0,
      billed: 0,
      pct_used: null,
      pct_billed: null,
      retainer_paid: 0,
      retainer_balance: 0,
      ar: 0,
      profit: 0,
      margin: null,
      row_kind: 'phase',
      parent_project: 'Job - 26-001',
    };
    const completedHeader = proj('Job - 26-001', 'COMPLETED', [phaseRow]);
    assert.equal(isActiveProjectNode(completedHeader), false);

    const activeHeader = proj('Job - 26-002', 'ACTIVE', [
      { ...phaseRow, status: 'COMPLETED', project: 'Job - CD', phase: 'CD' },
    ]);
    assert.equal(isActiveProjectNode(activeHeader), true);
  });
});

describe('clientNamesWithActiveProjects', () => {
  it('includes only clients with an active project header', () => {
    const hierarchy: ClientNode[] = [
      {
        client: 'Active Co',
        projects: [proj('Job A - 26-001', 'ACTIVE')],
        singleProject: true,
        contract: 0,
        billed: 0,
        outstanding: 0,
        phaseCount: 0,
      },
      {
        client: 'Done Co',
        projects: [proj('Job B - 25-002', 'COMPLETED')],
        singleProject: true,
        contract: 0,
        billed: 0,
        outstanding: 0,
        phaseCount: 0,
      },
    ];
    assert.equal(clientHasActiveProject(hierarchy[0]!), true);
    assert.equal(clientHasActiveProject(hierarchy[1]!), false);
    assert.deepEqual(clientNamesWithActiveProjects(hierarchy), ['Active Co']);
  });
});
