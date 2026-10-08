import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTaskRowMeta, serializeTaskRowMeta } from './taskRowMeta';

describe('taskRowMeta', () => {
  it('round-trips links in mdesigns_comments', () => {
    const text = serializeTaskRowMeta('Notes here', {
      links: [{ label: 'Drive', url: 'https://drive.google.com/x' }],
    });
    const parsed = parseTaskRowMeta(text);
    assert.equal(parsed.notes, 'Notes here');
    assert.equal(parsed.links.length, 1);
    assert.equal(parsed.links[0]!.label, 'Drive');
  });

  it('returns empty links when no meta line', () => {
    const parsed = parseTaskRowMeta('Plain comment');
    assert.deepEqual(parsed.links, []);
    assert.equal(parsed.notes, 'Plain comment');
  });
});
