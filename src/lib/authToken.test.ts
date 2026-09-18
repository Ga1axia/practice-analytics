import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accessTokenNeedsRefresh } from './authTokenExpiry';

describe('accessTokenNeedsRefresh', () => {
  it('refreshes when expiry is missing', () => {
    assert.equal(accessTokenNeedsRefresh(undefined, 1_000_000), true);
    assert.equal(accessTokenNeedsRefresh(null, 1_000_000), true);
  });

  it('keeps a token with more than 60s left', () => {
    const now = 1_700_000_000_000;
    const expiresAt = Math.floor(now / 1000) + 120;
    assert.equal(accessTokenNeedsRefresh(expiresAt, now), false);
  });

  it('refreshes when expiry is within 60s', () => {
    const now = 1_700_000_000_000;
    const expiresAt = Math.floor(now / 1000) + 30;
    assert.equal(accessTokenNeedsRefresh(expiresAt, now), true);
  });
});
