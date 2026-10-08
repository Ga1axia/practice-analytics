import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isInteriorDesignPhaseLabel,
  projectHasInteriorDesignPhase,
  resolveEmployeePortalPrefs,
} from './employeePortalPrefs';
import type { ProjectNode } from './projectListHierarchy';

describe('employeePortalPrefs', () => {
  it('defaults Arnita to interior-focused portal prefs', () => {
    const prefs = resolveEmployeePortalPrefs({ employeeName: 'Arnita Serri' });
    assert.equal(prefs.interiorProjectsOption, true);
    assert.equal(prefs.defaultInteriorProjects, true);
    assert.equal(prefs.defaultInteriorHours, true);
  });

  it('detects interior design phases on projects', () => {
    const project: ProjectNode = {
      key: 'P',
      title: 'Residence',
      code: null,
      row: null,
      phases: [{ label: 'Interior Design', row: { phase: 'Interior Design' } as never }],
      contract: 0,
      billed: 0,
      outstanding: 0,
      billedHours: 0,
      spentHours: 0,
    };
    assert.ok(projectHasInteriorDesignPhase(project));
    assert.ok(isInteriorDesignPhaseLabel('Interior Design Services'));
  });
});
