function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

const PTO_SICK_RE =
  /\b(pto|sick(?:\s*time)?|vacation|holiday|bereavement|leave without pay|\blwp\b|time\s*off)\b/;

export type TimeEntryPtoFields = {
  activity?: string | null;
  project_name?: string | null;
  parent_project_name?: string | null;
  phase?: string | null;
  phase_name?: string | null;
};

/** PTO / sick / holiday / vacation — not delivery hours, membership, or "has hours". */
export function isPtoOrSickTimeEntry(row: TimeEntryPtoFields): boolean {
  const activity = String(row.activity || '').toLowerCase();
  if (PTO_SICK_RE.test(activity)) return true;
  const project = [
    row.parent_project_name,
    row.project_name,
    row.phase,
    row.phase_name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/\s[-–]\s*pto\b/.test(project) || /\bpto\b/.test(project)) return true;
  if (/\bsick(?:\s*time)?\b/.test(project)) return true;
  return false;
}

/** Extract `22-004`-style job code from a project label. */
export function extractProjectCode(name: string | null | undefined): string | null {
  const m = (name || '').match(/\b(\d{2}-\d{3})\b/);
  return m ? m[1]! : null;
}

/** Drop `22-004` tokens so CORE time-entry labels without codes still match. */
export function stripJobCodes(s: string | null | undefined): string {
  return String(s || '')
    .replace(/\b(\d{2}-\d{3})\b/g, ' ')
    .replace(/\s*[-–]\s*$/g, '')
    .replace(/^\s*[-–]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleTokens(title: string): string[] {
  return norm(stripJobCodes(title))
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !/^\d{2}-\d{3}$/.test(t));
}

/** True when a TE project label belongs to this Project List project. */
export function timeEntryMatchesProject(
  row: { project_name?: string | null; parent_project_name?: string | null },
  opts: { fullName?: string | null; title?: string | null; code?: string | null },
): boolean {
  const parent = norm(row.parent_project_name || '');
  const project = norm(row.project_name || '');
  const blob = `${parent} ${project}`;
  if (!blob.trim()) return false;

  const code = norm(opts.code || extractProjectCode(opts.fullName) || extractProjectCode(opts.title) || '');
  if (code && /^\d{2}-\d{3}$/.test(code) && blob.includes(code)) {
    return true;
  }

  const fullBare = norm(stripJobCodes(opts.fullName || ''));
  const titleBare = norm(stripJobCodes(opts.title || ''));
  const teParent = norm(stripJobCodes(row.parent_project_name || '')) || parent;

  if (fullBare.length >= 5 && (teParent === fullBare || parent.includes(fullBare) || blob.includes(fullBare))) {
    return true;
  }

  if (titleBare.length >= 5 && (teParent === titleBare || parent.includes(titleBare) || blob.includes(titleBare))) {
    return true;
  }

  const full = norm(opts.fullName || '');
  if (full.length >= 5 && (parent.includes(full) || project.includes(full) || blob.includes(full))) {
    return true;
  }

  const title = norm(opts.title || '');
  if (title.length >= 5 && (parent.includes(title) || project.includes(title) || blob.includes(title))) {
    return true;
  }

  const tokens = titleTokens(opts.title || opts.fullName || '');
  if (tokens.length >= 2 && tokens.filter((t) => blob.includes(t)).length >= 2) {
    return true;
  }

  return false;
}

export type ProjectMatchRef = { key: string; title?: string | null; code?: string | null };

export function buildTimeEntryProjectIndex(projects: ProjectMatchRef[]): {
  byCode: Map<string, string>;
  byBare: Map<string, string[]>;
} {
  const byCode = new Map<string, string>();
  const byBare = new Map<string, string[]>();
  for (const p of projects) {
    const code = (p.code || extractProjectCode(p.key) || extractProjectCode(p.title) || '').trim();
    if (/^\d{2}-\d{3}$/.test(code)) byCode.set(code, p.key);
    const bare = norm(stripJobCodes(p.title || p.key));
    if (bare.length < 4) continue;
    const list = byBare.get(bare) || [];
    if (!list.includes(p.key)) list.push(p.key);
    byBare.set(bare, list);
  }
  return { byCode, byBare };
}

/** Library project keys that this CORE time-entry row belongs to. */
export function projectKeysForTimeEntry(
  row: { project_name?: string | null; parent_project_name?: string | null },
  index: ReturnType<typeof buildTimeEntryProjectIndex>,
): string[] {
  const keys = new Set<string>();
  for (const raw of [row.parent_project_name, row.project_name]) {
    const code = extractProjectCode(raw);
    if (code) {
      const hit = index.byCode.get(code);
      if (hit) keys.add(hit);
    }
  }
  const parentBare = norm(stripJobCodes(row.parent_project_name || ''));
  const fromProject = String(row.project_name || '');
  const cut = fromProject.match(/^(.*)\s[-–]\s.+$/);
  const projectParentBare = norm(stripJobCodes(cut ? cut[1]! : fromProject));
  for (const bare of [parentBare, projectParentBare]) {
    if (!bare || bare.length < 4) continue;
    for (const k of index.byBare.get(bare) || []) keys.add(k);
  }
  return [...keys];
}
