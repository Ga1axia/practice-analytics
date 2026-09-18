import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseLooseDate, parseMeetingSummary } from './parseMeetingSummary';

describe('parseMeetingSummary', () => {
  it('keeps a plain paste as notes and uses the first line as title', () => {
    const parsed = parseMeetingSummary(
      'SD pin-up\n\nClient liked the east elevation. Follow up on finishes next week.',
    );
    assert.equal(parsed.title, 'SD pin-up');
    assert.equal(parsed.attendees, '');
    assert.equal(parsed.meetingAt, null);
    assert.match(parsed.notes, /east elevation/);
  });

  it('reads labeled title, date, and attendees', () => {
    const parsed = parseMeetingSummary(`Title: Design review
Date: September 18, 2026 2:00 PM
Attendees: Taihei Eastwood, Thiru Sinnathamby

Confirmed the kitchen layout.`);
    assert.equal(parsed.title, 'Design review');
    assert.equal(parsed.attendees, 'Taihei Eastwood, Thiru Sinnathamby');
    assert.ok(parsed.meetingAt);
    const d = new Date(parsed.meetingAt!);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 8);
    assert.equal(d.getDate(), 18);
    assert.match(parsed.notes, /kitchen layout/);
  });

  it('parses a Teams-style recap with attendees on following lines', () => {
    const parsed = parseMeetingSummary(`Meeting recap
Kickoff / program review

Thursday, September 4, 2026
Attendees
Arnita Serri
Thiru Sinnathamby

Summary
Confirmed scope, budget band, and biweekly cadence.`);
    assert.equal(parsed.title, 'Kickoff / program review');
    assert.equal(parsed.attendees, 'Arnita Serri, Thiru Sinnathamby');
    assert.ok(parsed.meetingAt);
    assert.match(parsed.notes, /biweekly cadence/);
  });

  it('does not treat random sentences as dates', () => {
    assert.equal(parseLooseDate('Follow up on finishes next week.'), null);
    assert.equal(parseLooseDate('Action item 1'), null);
  });
});
