/** Phase manager imported from CORE — stored on phase row mdesigns_comments. */

export type PhaseRowMeta = {
  manager?: string;
};

const META_LINE = /^pa-phase-meta:\s*(\{.*\})\s*$/m;

export function parsePhaseRowMeta(comments: string): {
  manager: string;
  notes: string;
} {
  const raw = comments || '';
  const match = raw.match(META_LINE);
  if (!match) {
    return { manager: '', notes: raw.trim() };
  }
  let manager = '';
  try {
    const parsed = JSON.parse(match[1]!) as Partial<PhaseRowMeta>;
    manager = String(parsed.manager || '').trim();
  } catch {
    manager = '';
  }
  const notes = raw.replace(META_LINE, '').trim();
  return { manager, notes };
}

export function serializePhaseRowMeta(notes: string, meta: PhaseRowMeta): string {
  const cleanNotes = (notes || '').replace(META_LINE, '').trim();
  const manager = (meta.manager || '').trim();
  if (!manager) return cleanNotes;
  const line = `pa-phase-meta:${JSON.stringify({ manager } satisfies PhaseRowMeta)}`;
  return cleanNotes ? `${cleanNotes}\n\n${line}` : line;
}

export function phaseManagerFromComments(comments: string | null | undefined): string {
  return parsePhaseRowMeta(comments || '').manager;
}
