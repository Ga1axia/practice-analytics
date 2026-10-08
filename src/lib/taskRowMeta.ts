/** Links and other UI metadata stored in pa_schedule_rows.mdesigns_comments. */

export type TaskLink = {
  label: string;
  url: string;
};

export type TaskRowMeta = {
  links: TaskLink[];
};

const META_LINE = /^pa-task-meta:\s*(\{.*\})\s*$/m;

export function parseTaskRowMeta(comments: string): {
  links: TaskLink[];
  notes: string;
} {
  const raw = comments || '';
  const match = raw.match(META_LINE);
  if (!match) {
    return { links: [], notes: raw.trim() };
  }
  let links: TaskLink[] = [];
  try {
    const parsed = JSON.parse(match[1]!) as Partial<TaskRowMeta>;
    if (Array.isArray(parsed.links)) {
      links = parsed.links
        .map((l) => ({
          label: String(l?.label || '').trim(),
          url: String(l?.url || '').trim(),
        }))
        .filter((l) => l.url);
    }
  } catch {
    links = [];
  }
  const notes = raw.replace(META_LINE, '').trim();
  return { links, notes };
}

export function serializeTaskRowMeta(notes: string, meta: TaskRowMeta): string {
  const cleanNotes = (notes || '').replace(META_LINE, '').trim();
  const links = (meta.links || [])
    .map((l) => ({
      label: (l.label || '').trim(),
      url: (l.url || '').trim(),
    }))
    .filter((l) => l.url);
  if (!links.length) return cleanNotes;
  const line = `pa-task-meta:${JSON.stringify({ links } satisfies TaskRowMeta)}`;
  return cleanNotes ? `${cleanNotes}\n\n${line}` : line;
}

export function normalizeTaskUrl(raw: string): string {
  const u = raw.trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(u)) return `https://${u}`;
  return u;
}
