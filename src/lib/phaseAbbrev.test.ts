import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchProcessPhaseIndex } from './architecturalProcess';
import { isAdditionalServicesPhase, phaseDisplayName } from './phaseAbbrev';

describe('phaseDisplayName', () => {
  it('does not invent Additional Services for CORE Other placeholder', () => {
    assert.equal(phaseDisplayName('Other', 'Tower - 26-001'), '');
    assert.equal(phaseDisplayName('Other', 'Tower - 26-001 - Schematic Design'), 'Schematic Design');
  });

  it('keeps explicit additional services phases from CORE', () => {
    assert.equal(phaseDisplayName('Additional Services', 'Tower - 26-001'), 'Additional Services');
    assert.ok(isAdditionalServicesPhase('Additional Services', null));
  });
});

describe('matchProcessPhaseIndex', () => {
  it('does not map Other or unknown labels to Additional Services', () => {
    assert.equal(matchProcessPhaseIndex('Other'), -1);
    assert.equal(matchProcessPhaseIndex('Reimbursable'), -1);
    assert.ok(matchProcessPhaseIndex('Additional Services') >= 0);
  });
});
