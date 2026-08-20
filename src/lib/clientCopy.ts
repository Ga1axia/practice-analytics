/** Client-facing spelling, labels, and jargon helpers. */

const TASK_FIXES: [RegExp, string][] = [
  [/\bfinalzied\b/gi, 'finalized'],
  [/\brecieved\b/gi, 'received'],
  [/\bsubmited\b/gi, 'submitted'],
  [/\bProgamming\b/g, 'Programming'],
  [/approval with Conditions/gi, 'approval with conditions'],
];

const PHASE_ALIASES: [RegExp, string][] = [
  [/^other items for clients to think about$/i, 'Client decisions needed'],
];

const GLOSSARY: { re: RegExp; title: string }[] = [
  {
    re: /\bCDs?\b|\bConstruction Documents\b/gi,
    title: 'Construction Documents — the detailed drawings used for permits and building.',
  },
  {
    re: /\bValue Engineering\b/gi,
    title:
      'Value engineering — adjusting scope or materials with the contractor to meet budget, then updating drawings.',
  },
  {
    re: /\bVastu\b/gi,
    title:
      'Vastu — traditional timing guidelines some families use for demolition and construction start dates.',
  },
  {
    re: /\bPlanning Package\b/gi,
    title: 'Planning Package — drawings and materials the city or county reviews before a building permit.',
  },
  {
    re: /\bSchematic Design\b/gi,
    title: 'Schematic design — early plans and elevations so you can react to the big design moves.',
  },
];

export function displayTaskTitle(title: string): string {
  let out = (title || '').trim();
  for (const [re, to] of TASK_FIXES) out = out.replace(re, to);
  return out;
}

export function displayPhaseTitleClient(title: string): string {
  const trimmed = (title || '').trim();
  for (const [re, to] of PHASE_ALIASES) {
    if (re.test(trimmed)) return to;
  }
  return displayTaskTitle(trimmed);
}

export function displayPersonName(name: string): string {
  return (name || '')
    .replace(/Renuga/gi, 'Renuka')
    .replace(/\s*&\s*/g, ' and ')
    .trim();
}

export function glossaryTitle(text: string): string | undefined {
  const hit = GLOSSARY.find((g) => {
    g.re.lastIndex = 0;
    return g.re.test(text);
  });
  for (const g of GLOSSARY) g.re.lastIndex = 0;
  return hit?.title;
}

export function clientNeedKind(text: string): 'approve' | 'upload' | 'none' {
  const t = text.toLowerCase();
  if (
    /\b(confirm|approve|fee|sign form|finalize the contractor|value-engineering|value engineering)\b/.test(
      t,
    )
  ) {
    return 'approve';
  }
  if (
    /\b(provide|upload|title report|inspiration|documents with information|information needed)\b/.test(
      t,
    )
  ) {
    return 'upload';
  }
  return 'none';
}

export type StaffContact = { email: string; phone: string | null };

const STAFF_CONTACTS: Record<string, StaffContact> = {
  'Arnita Serri': { email: 'arnita@mdesignsarchitects.com', phone: null },
  'Ni Ni': { email: 'nini@mdesignsarchitects.com', phone: null },
  'Zhengrui He': { email: 'zhengrui@mdesignsarchitects.com', phone: null },
  'Maria Abreu': { email: 'maria@mdesignsarchitects.com', phone: null },
  'Malika Junaid': { email: 'malika@mdesignsarchitects.com', phone: null },
  'Maurits de Gans': { email: 'maurits@mdesignsarchitects.com', phone: null },
};

export function staffContact(name: string | null | undefined): StaffContact | null {
  const n = (name || '').trim();
  if (!n) return null;
  if (STAFF_CONTACTS[n]) return STAFF_CONTACTS[n]!;
  const first = n.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
  if (!first) return null;
  return { email: `${first}@mdesignsarchitects.com`, phone: null };
}

/** Shared Box / Box Cloud HTTPS links only. */
export function isBoxShareUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return (
      host === 'box.com' ||
      host.endsWith('.box.com') ||
      host === 'boxcloud.com' ||
      host.endsWith('.boxcloud.com')
    );
  } catch {
    return false;
  }
}

/** Client-facing file groups — design documents only, not process stages. */
export const CLIENT_FILE_CATEGORIES = [
  { id: 'drawings', label: 'Drawings & plans' },
  { id: 'renderings', label: 'Renderings & 3D' },
  { id: 'packages', label: 'Design packages' },
] as const;

export type ClientFileCategoryId = (typeof CLIENT_FILE_CATEGORIES)[number]['id'];

const FILE_EXCLUDE =
  /feedback|review cycle|start of|\bstarted\b|request for proposal|\brfp\b|\breceived\b|comments?\b|surveyor|soils|arborist|shop drawing|punch list|contractor bid|value engineering|\bve\b|coordination|consultant|story pole|hearing|commissioner|as-built survey|title report|invoice|\brfi\b|shop drawing/i;

const FILE_EXCLUDE_OVERRIDE =
  /planning package|permit set|cd set|construction documents|presentation (finished|to client)|sign off on plans|package finish|design package|color board|material board/i;

export function isClientFileCategoryId(value: string): value is ClientFileCategoryId {
  return CLIENT_FILE_CATEGORIES.some((c) => c.id === value);
}

/** Infer a design category from a title, or null if it is not a client-facing design file. */
export function categorizeClientFile(title: string): ClientFileCategoryId | null {
  const t = (title || '').trim();
  if (!t) return null;
  if (/feedback|comments?\b/i.test(t)) return null;
  if (
    /\b(start|started|kickoff|kick-off)\b/i.test(t) &&
    !/\b(finish|finished|completion)\b/i.test(t)
  ) {
    return null;
  }
  if (FILE_EXCLUDE.test(t) && !FILE_EXCLUDE_OVERRIDE.test(t)) return null;
  if (
    /render|3-?d|visualization|material board|color board|finish board|mood board/i.test(t)
  ) {
    return 'renderings';
  }
  if (
    /planning package|permit (set|package)|cd set|construction documents|design package|presentation package|outline spec/i.test(
      t,
    )
  ) {
    return 'packages';
  }
  if (
    /floor plan|site plan|elevation|drawing|schematic|plan set|existing condition|as-built drawing/i.test(
      t,
    )
  ) {
    return 'drawings';
  }
  return null;
}

/**
 * Map a stored Box `section` (category id, old process stage, or free text) plus title
 * onto one of the client file categories. Staff-shared links always land in a group.
 */
export function normalizeClientFileCategory(
  section: string,
  title = '',
): ClientFileCategoryId {
  const raw = (section || '').trim();
  const lower = raw.toLowerCase();
  if (isClientFileCategoryId(lower)) return lower;
  const byLabel = CLIENT_FILE_CATEGORIES.find((c) => c.label.toLowerCase() === lower);
  if (byLabel) return byLabel.id;
  const fromTitle = categorizeClientFile(title);
  if (fromTitle) return fromTitle;
  if (/planning|package|permit|cd|construction document/.test(lower)) return 'packages';
  if (/render|3-?d|board/.test(lower)) return 'renderings';
  return 'drawings';
}

export function clientFileCategoryLabel(id: ClientFileCategoryId): string {
  return CLIENT_FILE_CATEGORIES.find((c) => c.id === id)?.label || 'Drawings & plans';
}
