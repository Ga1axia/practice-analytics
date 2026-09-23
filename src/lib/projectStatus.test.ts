import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isActiveProjectStatus, normalizeProjectStatus } from './projectStatus';

describe('normalizeProjectStatus', () => {
  it('does not treat blank or non-active CORE states as Active', () => {
    assert.equal(normalizeProjectStatus(null), 'UNKNOWN');
    assert.equal(normalizeProjectStatus(''), 'UNKNOWN');
    assert.equal(normalizeProjectStatus('DRAFT'), 'DRAFT');
    assert.equal(normalizeProjectStatus('Hold'), 'HOLD');
    assert.equal(normalizeProjectStatus('Canceled'), 'CANCELED');
    assert.equal(normalizeProjectStatus('Inactive'), 'INACTIVE');
    assert.equal(normalizeProjectStatus('Completed'), 'COMPLETED');
  });

  it('isActiveProjectStatus is strict', () => {
    assert.equal(isActiveProjectStatus('ACTIVE'), true);
    assert.equal(isActiveProjectStatus('Active'), true);
    assert.equal(isActiveProjectStatus('DRAFT'), false);
    assert.equal(isActiveProjectStatus('HOLD'), false);
    assert.equal(isActiveProjectStatus(undefined), false);
  });
});
