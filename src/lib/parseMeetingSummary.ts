/** Pull title / date / attendees out of a pasted recap. The original text is always kept. */

export type ParsedMeetingSummary = {
  title: string;
  meetingAt: string | null;
  attendees: string;
  notes: string;
};

const SKIP_TITLE =
  /^(meeting recap|meeting notes|meeting summary|recap|summary|notes|ai notes|copilot recap|gemini notes)$/i;

const LABELED_TITLE = /^(title|subject|meeting)\s*[:\-–]\s*(.+)$/i;
const LABELED_DATE = /^(date|when|meeting date|started(?: time)?|start(?: time)?)\s*[:\-–]\s*(.+)$/i;
const LABELED_ATTENDEES = /^(attendees?|participants?|invitees?)\s*[:\-–]?\s*(.*)$/i;
const SECTION_HEAD =
  /^(summary|action items?|notes|agenda|next steps?|overview|transcript|chapters?)\s*[:\-–]?$/i;
const MONTH =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

function looksLikeDate(value: string): boolean {
  const t = value.trim();
  if (!t || t.length > 80) return false;
  if (/\d{4}-\d{1,2}-\d{1,2}/.test(t)) return true;
  if (/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(t)) return true;
  return new RegExp(`\\b(?:${MONTH})\\b`, 'i').test(t) && /\d/.test(t);
}

export function parseLooseDate(value: string): string | null {
  if (!looksLikeDate(value)) return null;
  const d = new Date(value.trim());
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  if (y < 1990 || y > 2100) return null;
  return d.toISOString();
}

function collectFollowingNames(lines: string[], start: number): string {
  const names: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const n = lines[i]!.trim();
    if (!n) break;
    if (SECTION_HEAD.test(n)) break;
    if (LABELED_TITLE.test(n) || LABELED_DATE.test(n) || LABELED_ATTENDEES.test(n)) break;
    if (looksLikeDate(n) && parseLooseDate(n)) break;
    names.push(n.replace(/^[-*•]\s*/, ''));
    if (names.length >= 24) break;
  }
  return names.join(', ');
}

export function parseMeetingSummary(raw: string): ParsedMeetingSummary {
  const notes = raw.replace(/\r\n/g, '\n').trim();
  const lines = notes.split('\n').map((l) => l.trimEnd());

  let title = '';
  let attendees = '';
  let meetingAt: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const titled = line.match(LABELED_TITLE);
    if (titled && !title) {
      title = titled[2]!.trim();
      continue;
    }

    const dated = line.match(LABELED_DATE);
    if (dated && !meetingAt) {
      meetingAt = parseLooseDate(dated[2]!);
      continue;
    }

    const att = line.match(LABELED_ATTENDEES);
    if (att && !attendees) {
      const rest = att[2]!.trim();
      attendees = rest || collectFollowingNames(lines, i + 1);
    }
  }

  if (!meetingAt) {
    for (const line of lines.slice(0, 10)) {
      const d = parseLooseDate(line.trim());
      if (d) {
        meetingAt = d;
        break;
      }
    }
  }

  if (!title) {
    for (const line of lines.slice(0, 8)) {
      const t = line.trim().replace(/^#+\s*/, '');
      if (!t) continue;
      if (SKIP_TITLE.test(t)) continue;
      if (LABELED_ATTENDEES.test(t) || LABELED_DATE.test(t)) continue;
      if (SECTION_HEAD.test(t)) continue;
      if (parseLooseDate(t)) continue;
      if (t.length <= 90) title = t;
      break;
    }
  }

  return { title, meetingAt, attendees, notes };
}
