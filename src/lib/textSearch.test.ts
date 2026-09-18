import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deterministicTextMatch, parseDeterministicQuery } from './textSearch';

describe('parseDeterministicQuery', () => {
  it('splits tokens and quoted phrases', () => {
    assert.deepEqual(parseDeterministicQuery('foo bar "Exact Phrase"'), {
      tokens: ['foo', 'bar'],
      phrases: ['exact phrase'],
    });
  });
});

describe('deterministicTextMatch', () => {
  it('requires all tokens and phrases', () => {
    const hay = 'Acme Tower 26-005 Jane Smith ACTIVE';
    assert.equal(deterministicTextMatch(hay, 'acme smith'), true);
    assert.equal(deterministicTextMatch(hay, 'acme missing'), false);
    assert.equal(deterministicTextMatch(hay, '"26-005" acme'), true);
    assert.equal(deterministicTextMatch(hay, '"26-006"'), false);
  });
});
