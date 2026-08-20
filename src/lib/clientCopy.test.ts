import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  categorizeClientFile,
  displayPersonName,
  displayPhaseTitleClient,
  displayTaskTitle,
  glossaryTitle,
  isBoxShareUrl,
  normalizeClientFileCategory,
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

  it('accepts Box share URLs only', () => {
    assert.equal(isBoxShareUrl('https://app.box.com/s/abc123'), true);
    assert.equal(isBoxShareUrl('https://mdesigns.app.box.com/file/1'), true);
    assert.equal(isBoxShareUrl('https://company.boxcloud.com/v/file'), true);
    assert.equal(isBoxShareUrl('http://app.box.com/s/abc'), false);
    assert.equal(isBoxShareUrl('https://dropbox.com/s/x'), false);
  });

  it('keeps only client-facing design files and groups them by kind', () => {
    assert.equal(categorizeClientFile('First Floor Plan presentation'), 'drawings');
    assert.equal(categorizeClientFile('Existing Condition Drawings - Completion'), 'drawings');
    assert.equal(categorizeClientFile('Elevations / 3-D presentation to Client'), 'renderings');
    assert.equal(categorizeClientFile('Material / color board'), 'renderings');
    assert.equal(categorizeClientFile('Planning Package finish'), 'packages');
    assert.equal(categorizeClientFile('Construction Documents Finished'), 'packages');
    assert.equal(categorizeClientFile('Soils report received'), null);
    assert.equal(categorizeClientFile('Surveyor CAD file'), null);
    assert.equal(categorizeClientFile('Shop drawings / submittals'), null);
    assert.equal(categorizeClientFile('Request for proposal — structural'), null);
    assert.equal(categorizeClientFile('Contractor bidding'), null);
    assert.equal(categorizeClientFile('Planning package start'), null);
    assert.equal(categorizeClientFile('Elevations / 3-D presentation Client feedback'), null);
  });

  it('maps stored Box sections onto file categories', () => {
    assert.equal(normalizeClientFileCategory('drawings', 'Anything'), 'drawings');
    assert.equal(normalizeClientFileCategory('CDs', 'Permit set Rev 2'), 'packages');
    assert.equal(normalizeClientFileCategory('Planning', 'Planning Package'), 'packages');
    assert.equal(normalizeClientFileCategory('Schematic', 'Floor plans'), 'drawings');
    assert.equal(normalizeClientFileCategory('', 'Front elevation rendering'), 'renderings');
    assert.equal(normalizeClientFileCategory('', 'Untitled share'), 'drawings');
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
