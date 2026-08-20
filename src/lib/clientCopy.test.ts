import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  displayPersonName,
  displayPhaseTitleClient,
  displayTaskTitle,
  glossaryTitle,
} from './clientCopy';
import { inferCurrentPhase, milestoneHealth, stageProgressPct } from './clientPortal';

describe('client copy', () => {
  it('fixes common schedule typos and capitalization', () => {
    assert.equal(displayTaskTitle('Contractor finalzied for bidding'), 'Contractor finalized for bidding');
    assert.equal(displayTaskTitle('PDF recieved'), 'PDF received');
    assert.equal(
      displayTaskTitle('approval with Conditions'),
      'approval with conditions',
    );
  });

  it('renames the catchall client-decision phase', () => {
    assert.equal(
      displayPhaseTitleClient('Other items for clients to think about'),
      'Client decisions needed',
    );
  });

  it('standardizes Sinnathamby naming in titles', () => {
    assert.equal(
      displayPersonName('Thiru and Renuga Sinnathamby - 26-012'),
      'Thiru and Renuka Sinnathamby - 26-012',
    );
    assert.equal(
      displayPersonName('Thiru & Renuka Sinnathamby'),
      'Thiru and Renuka Sinnathamby',
    );
  });

  it('explains Vastu and CDs', () => {
    assert.match(glossaryTitle('Vastu dates for demolition') || '', /Vastu/);
    assert.match(glossaryTitle('CDs') || '', /Construction Documents/);
  });
});

describe('client portal phase inference', () => {
  it('uses an active interior child instead of Other/Additional', () => {
    const phase = inferCurrentPhase('Other', ['Interior Design Services', 'Additional Services']);
    assert.match(phase || '', /interior/i);
  });

  it('keeps a specific header phase', () => {
    assert.equal(inferCurrentPhase('Planning Package', ['Interior Design']), 'Planning Package');
  });

  it('maps progress and health', () => {
    assert.ok(stageProgressPct(4) > 0);
    assert.equal(milestoneHealth(1, 1), 'Blocked');
    assert.equal(milestoneHealth(1, 0), 'At Risk');
    assert.equal(milestoneHealth(0, 0), 'On Track');
  });
});
