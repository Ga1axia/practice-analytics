import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyWorkType, WORK_TYPES } from './workType';

describe('classifyWorkType', () => {
  it('exposes exactly the five firm types', () => {
    assert.deepEqual(WORK_TYPES, ['New', 'Remodel', 'ADU', 'Interior', 'Commercial']);
  });

  it('classifies ADU before residence catch-all', () => {
    assert.equal(classifyWorkType('Nguyen Residence ADU'), 'ADU');
    assert.equal(classifyWorkType('Smith Guest House'), 'ADU');
    assert.equal(classifyWorkType('Lopez Casita'), 'ADU');
    assert.equal(classifyWorkType('Accessory Dwelling - CD'), 'ADU');
  });

  it('classifies Interior from name and ID tokens', () => {
    assert.equal(classifyWorkType('Birla Residence - Interior Design'), 'Interior');
    assert.equal(classifyWorkType('Chen Interiors'), 'Interior');
    assert.equal(classifyWorkType('Park Residence - ID'), 'Interior');
    assert.equal(classifyWorkType('Wong / ID'), 'Interior');
  });

  it('classifies Remodel and additions as Remodel', () => {
    assert.equal(classifyWorkType('Garcia Remodel'), 'Remodel');
    assert.equal(classifyWorkType('Lee Home Renovation'), 'Remodel');
    assert.equal(classifyWorkType('Patel Residence Addition'), 'Remodel');
    assert.equal(classifyWorkType('Kitchen Rehab'), 'Remodel');
  });

  it('classifies Commercial and multi-family as Commercial', () => {
    assert.equal(classifyWorkType('Market Street Mixed-Use'), 'Commercial');
    assert.equal(classifyWorkType('Oak Retail'), 'Commercial');
    assert.equal(classifyWorkType('Harbor Duplex'), 'Commercial');
  });

  it('defaults residences and unknowns to New', () => {
    assert.equal(classifyWorkType('Othmer Residence'), 'New');
    assert.equal(classifyWorkType('Custom Home - SD'), 'New');
    assert.equal(classifyWorkType('Mystery Job 25-001'), 'New');
  });

  it('honors explicit labels and ignores contract FIXED/HOURLY', () => {
    assert.equal(classifyWorkType('Anything', 'Remodel'), 'Remodel');
    assert.equal(classifyWorkType('Anything', 'ADU'), 'ADU');
    assert.equal(classifyWorkType('Anything', 'Interior'), 'Interior');
    assert.equal(classifyWorkType('Anything', 'Addition'), 'Remodel');
    assert.equal(classifyWorkType('Othmer Residence', 'FIXED'), 'New');
  });
});
