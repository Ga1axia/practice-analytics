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
