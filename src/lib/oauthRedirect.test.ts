import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { oauthErrorFromSearch, oauthRedirectTo } from './oauthRedirect';

describe('oauthRedirectTo', () => {
  it('returns origin for production paths', () => {
    assert.equal(oauthRedirectTo('http://localhost:5173', '/'), 'http://localhost:5173');
    assert.equal(oauthRedirectTo('https://practice-analytics-six.vercel.app', '/'), 'https://practice-analytics-six.vercel.app');
  });

  it('keeps demo users on /demo after Microsoft returns', () => {
    assert.equal(oauthRedirectTo('http://localhost:5173', '/demo'), 'http://localhost:5173/demo');
    assert.equal(oauthRedirectTo('http://localhost:5173', '/demo/'), 'http://localhost:5173/demo');
  });
});

describe('oauthErrorFromSearch', () => {
  it('reads Azure/Supabase error query params', () => {
    assert.equal(
      oauthErrorFromSearch('?error=access_denied&error_description=User+cancelled'),
      'User cancelled',
    );
    assert.equal(oauthErrorFromSearch(''), null);
  });
});
