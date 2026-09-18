import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  contractTypeForPhase,
  isMixedBillingPhase,
  mapBqeContractType,
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
});

describe('contractTypeForPhase', () => {
  it('treats Planning and Pre-Design as mixed', () => {
    assert.equal(isMixedBillingPhase('Planning Package'), true);
    assert.equal(isMixedBillingPhase('08 Plannin'), true);
    assert.equal(isMixedBillingPhase('Pre-Design Phase'), true);
    assert.equal(isMixedBillingPhase('01 Pre-Des'), true);
    assert.equal(isMixedBillingPhase('Construction Documents'), false);
  });

  it('copies CORE for mixed phases only', () => {
    assert.equal(contractTypeForPhase('Planning Package', 0), 'HOURLY');
    assert.equal(contractTypeForPhase('Planning Package', 1), 'FIXED');
    assert.equal(contractTypeForPhase('Pre-Design Phase', 0, 1), 'HOURLY');
    assert.equal(contractTypeForPhase('Pre-Design Phase', null, 1), 'FIXED');
  });

  it('keeps known hourly/fixed phases even when CORE differs', () => {
    assert.equal(contractTypeForPhase('Contractor Selection', 1), 'HOURLY');
    assert.equal(contractTypeForPhase('Construction Support', 1), 'HOURLY');
    assert.equal(contractTypeForPhase('Additional Services', 1), 'HOURLY');
    assert.equal(contractTypeForPhase('Reimbursable', 1), 'HOURLY');
    assert.equal(contractTypeForPhase('Project Management', 1), 'HOURLY');
    assert.equal(contractTypeForPhase('Design Development', 0), 'FIXED');
    assert.equal(contractTypeForPhase('Construction Documents', 0), 'FIXED');
  });
});

describe('mapCoreProjects billing type', () => {
  it('uses the phase CORE type for Planning, not the parent', () => {
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
    ]);
    const planning = mapped.rows.find((r) => r.phase === 'Planning Package');
    const cds = mapped.rows.find((r) => r.phase === 'Construction Documents');
    assert.equal(planning?.type, 'HOURLY');
    assert.equal(cds?.type, 'FIXED');
  });
});
