import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  contractTypeForPhase,
  CORE_PROJECT_WHERE_ACTIVE,
  mapBqeContractType,
  mapBqeStatus,
} from './bqe';
import { mapCoreProjects } from './bqeSyncBuild';
import type { BqeProject } from './bqe';

function proj(partial: Partial<BqeProject> & Pick<BqeProject, 'id'>): BqeProject {
  return { name: partial.name || partial.id, ...partial };
}

describe('mapBqeContractType', () => {
  it('maps CORE numeric enums with Hourly as 0', () => {
    assert.equal(mapBqeContractType(0), 'HOURLY');
    assert.equal(mapBqeContractType(1), 'FIXED');
    assert.equal(mapBqeContractType(2), 'HNTE');
    assert.equal(mapBqeContractType(3), 'MARKETING');
    assert.equal(mapBqeContractType(4), 'OVERHEAD');
  });

  it('maps named CORE strings and does not treat HNTE as Hourly', () => {
    assert.equal(mapBqeContractType('Hourly'), 'HOURLY');
    assert.equal(mapBqeContractType('Fixed'), 'FIXED');
    assert.equal(mapBqeContractType('Hourly Not to Exceed'), 'HNTE');
  });

  it('unwraps CORE enum objects', () => {
    assert.equal(mapBqeContractType({ value: 0, name: 'Hourly' }), 'HOURLY');
    assert.equal(mapBqeContractType({ value: 1, name: 'Fixed' }), 'FIXED');
  });
});

describe('contractTypeForPhase', () => {
  it('copies CORE on every phase, including known hourly/fixed names', () => {
    assert.equal(contractTypeForPhase(0), 'HOURLY');
    assert.equal(contractTypeForPhase(1), 'FIXED');
    assert.equal(contractTypeForPhase(0, 1), 'HOURLY');
    assert.equal(contractTypeForPhase(null, 1), 'FIXED');
    assert.equal(contractTypeForPhase(1), 'FIXED');
    assert.equal(contractTypeForPhase(0), 'HOURLY');
  });
});

describe('mapCoreProjects billing type', () => {
  it('uses each phase CORE type, not firm defaults or the parent', () => {
    const mapped = mapCoreProjects([
      proj({ id: 'root', name: '26-040 Deming', contractType: 1 }),
      proj({
        id: 'plan',
        name: '26-040 Deming',
        parentId: 'root',
        phaseDescription: 'Planning Package',
        contractType: 0,
      }),
      proj({
        id: 'cd',
        name: '26-040 Deming',
        parentId: 'root',
        phaseDescription: 'Construction Documents',
        contractType: 0,
      }),
      proj({
        id: 'dd',
        name: '26-040 Deming',
        parentId: 'root',
        phaseDescription: 'Design Development',
        contractType: 1,
      }),
    ]);
    const planning = mapped.rows.find((r) => r.phase === 'Planning Package');
    const cds = mapped.rows.find((r) => r.phase === 'Construction Documents');
    const dds = mapped.rows.find((r) => r.phase === 'Design Development');
    assert.equal(planning?.type, 'HOURLY');
    assert.equal(cds?.type, 'HOURLY');
    assert.equal(dds?.type, 'FIXED');
  });
});

describe('mapBqeStatus', () => {
  it('maps CORE numeric ProjectStatus', () => {
    assert.equal(mapBqeStatus(0), 'ACTIVE');
    assert.equal(mapBqeStatus(1), 'INACTIVE');
    assert.equal(mapBqeStatus(2), 'COMPLETED');
  });

  it('treats CORE completedOn as Completed even when status is Active', () => {
    assert.equal(mapBqeStatus(0, '2024-06-01T00:00:00'), 'COMPLETED');
    assert.equal(mapBqeStatus({ value: 0, name: 'Active' }, '2024-06-01'), 'COMPLETED');
  });

  it('unwraps CORE enum objects and prefers the name CORE shows', () => {
    assert.equal(mapBqeStatus({ value: 2, name: 'Completed' }), 'COMPLETED');
    assert.equal(mapBqeStatus({ name: 'Completed' }), 'COMPLETED');
    assert.equal(mapBqeStatus({ value: 0, name: 'Completed' }), 'COMPLETED');
  });

  it('filters Active with status=0 (no spaces — CORE where parser)', () => {
    assert.equal(CORE_PROJECT_WHERE_ACTIVE, 'status=0');
  });
});

describe('mapCoreProjects status', () => {
  it('uses each CORE record status, not the parent', () => {
    const mapped = mapCoreProjects([
      proj({ id: 'root', name: '26-040 Deming', status: 0 }),
      proj({
        id: 'cd',
        name: '26-040 Deming',
        parentId: 'root',
        phaseDescription: 'Construction Documents',
        status: 2,
      }),
    ]);
    const header = mapped.rows.find((r) => r.row_kind === 'project');
    const cds = mapped.rows.find((r) => r.phase === 'Construction Documents');
    assert.equal(header?.status, 'ACTIVE');
    assert.equal(cds?.status, 'COMPLETED');
  });

  it('marks Completed phases under an Active parent from completedOn', () => {
    const mapped = mapCoreProjects([
      proj({ id: 'root', name: 'Erdmann Residence II', status: 0 }),
      proj({
        id: 'pd',
        name: 'Erdmann Residence II',
        parentId: 'root',
        phaseDescription: 'Pre-Design',
        status: 0,
        completedOn: '2023-04-01T00:00:00',
      }),
    ]);
    const header = mapped.rows.find((r) => r.row_kind === 'project');
    const pd = mapped.rows.find((r) => r.phase === 'Pre-Design');
    assert.equal(header?.status, 'ACTIVE');
    assert.equal(pd?.status, 'COMPLETED');
  });

  it('still writes a Completed phase when the parent is not on this page', () => {
    const mapped = mapCoreProjects([
      proj({
        id: 'pd',
        name: 'Erdmann Residence II',
        parentId: 'root',
        parent: 'Erdmann Residence II',
        phaseDescription: 'Pre-Design',
        status: { value: 0, name: 'Completed' },
        contractType: { value: 1, name: 'Fixed' },
      }),
    ]);
    assert.equal(mapped.rows.length, 1);
    assert.equal(mapped.rows[0]?.row_kind, 'phase');
    assert.equal(mapped.rows[0]?.status, 'COMPLETED');
    assert.equal(mapped.rows[0]?.type, 'FIXED');
    assert.equal(mapped.rows[0]?.parent_project, 'Erdmann Residence II');
  });
});
