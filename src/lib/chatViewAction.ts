import type { DashboardData, ProjectRow } from './types';

/** Filters the AI can push onto Main Report / analysis views. */
export type ChatViewAction = {
  clear?: boolean;
  project?: string;
  client?: string;
  manager?: string;
  phase?: string;
  status?: string;
  /** Human label for the chat bubble. */
  label: string;
};

const STOPWORDS = new Set([
  'the', 'and', 'for', 'what', 'which', 'how', 'many', 'much', 'who', 'whose',
  'is', 'are', 'was', 'were', 'of', 'to', 'a', 'an', 'in', 'on', 'at', 'by',
  'with', 'from', 'total', 'amount', 'value', 'number', 'count', 'highest',
  'lowest', 'most', 'least', 'project', 'projects', 'client', 'clients',
  'manager', 'managers', 'employee', 'employees', 'team', 'billed', 'billing',
  'contract', 'contracts', 'profit', 'margin', 'owed', 'overdue', 'aging',
  'receivable', 'hours', 'month', 'monthly', 'year', 'there', 'their', 'this',
  'that', 'have', 'has', 'been', 'about', 'show', 'give', 'tell', 'please',
  'sheet', 'firm', 'practice', 'design', 'designs', 'architect', 'architects',
  'me', 'all', 'only', 'just', 'filter', 'filters', 'find', 'focus', 'open',
  'display', 'list', 'see', 'looking', 'look', 'where', 'under', 'managed',
  'leading', 'lead', 'phase', 'status', 'active', 'completed',
]);

const FILTER_RE =
  /^(?:show|filter|find|focus|open|display|list)\s+(?:me\s+|only\s+|just\s+)?(.+)$/i;
const CLEAR_RE =
  /^(?:clear(?:\s+filters?)?|reset(?:\s+filters?)?|show\s+all(?:\s+projects?)?|all\s+projects?)\s*[.!?]?$/i;

function tokensOf(text: string) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function nameScore(question: string, name: string | null | undefined): number {
  if (!name) return 0;
  const q = question.toLowerCase();
  const n = String(name).toLowerCase().trim();
  if (n.length < 2) return 0;
  if (q.includes(n)) return 1000 + n.length;

  const nameTokens = tokensOf(n);
  if (!nameTokens.length) return 0;
  let hit = 0;
  let hitLen = 0;
  for (const t of nameTokens) {
    const re = new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`);
    if (re.test(q)) {
      hit += 1;
      hitLen += t.length;
    }
  }
  if (!hit) return 0;
  if (hit === 1 && hitLen < 5 && nameTokens.length > 1) return 0;
  return hit * 50 + hitLen + (hit === nameTokens.length ? 100 : 0);
}

function bestName(question: string, names: string[]): string | null {
  const uniq = [...new Set(names.filter((n) => n && n.trim().length >= 2))];
  const scored = uniq
    .map((name) => ({ name, score: nameScore(question, name) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.name.length - a.name.length);
  if (!scored.length) return null;
  return scored[0]!.name;
}

function projectKeys(rows: ProjectRow[]): string[] {
  const headers = rows.filter((r) => r.row_kind === 'project').map((r) => r.project);
  if (headers.length) return headers;
  return [...new Set(rows.map((r) => r.project).filter(Boolean))];
}

function catalogFromData(data: DashboardData) {
  const clients = [
    ...new Set(data.projects.map((r) => r.client).filter((c): c is string => !!c && !!c.trim())),
  ];
  const managers =
    data.managers?.length
      ? data.managers
      : [
          ...new Set(
            data.projects.map((r) => r.manager).filter((m): m is string => !!m && !!m.trim()),
          ),
        ];
  const phases = [
    ...new Set(
      data.projects
        .map((r) => r.phase)
        .filter((p): p is string => !!p && p !== 'Other' && p !== 'Internal/PTO'),
    ),
  ];
  const statuses = (data.statuses || []).filter((s) => s && s !== 'UNKNOWN');
  return {
    projects: projectKeys(data.projects),
    clients,
    managers,
    phases,
    statuses: statuses.length ? statuses : ['ACTIVE'],
  };
}

/** True when the question is asking to change the visible filter, not just ask a fact. */
export function looksLikeViewCommand(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (CLEAR_RE.test(q)) return true;
  return FILTER_RE.test(q);
}

/**
 * Parse a "show me …" / "filter …" / "clear filters" style request into a view action.
 * Returns null when the question is a normal data question (not a view command).
 */
export function parseChatViewAction(
  question: string,
  data: DashboardData,
): ChatViewAction | null {
  const q = question.trim();
  if (!q) return null;

  if (CLEAR_RE.test(q)) {
    return { clear: true, label: 'Cleared filters — showing all projects.' };
  }

  const m = q.match(FILTER_RE);
  if (!m) return null;

  const subject = m[1]!.trim().replace(/[.!?]+$/, '');
  if (!subject || /^(all|everything|everything\s+again)$/i.test(subject)) {
    return { clear: true, label: 'Cleared filters — showing all projects.' };
  }

  const cat = catalogFromData(data);
  const haystack = subject;

  // Prefer exact field cues when present
  const wantsManager = /\b(manager|managed\s+by|lead|pm)\b/i.test(q);
  const wantsClient = /\bclient\b/i.test(q);
  const wantsPhase = /\bphase\b/i.test(q);
  const wantsStatus = /\bstatus\b/i.test(q);
  const wantsProject = /\bproject\b/i.test(q);

  const statusHit =
    bestName(haystack, cat.statuses) ||
    (/^active\b/i.test(subject) || /\bactive\b/i.test(q) ? 'ACTIVE' : null);
  const phaseHit = bestName(haystack, cat.phases);
  const managerHit = bestName(haystack, cat.managers);
  const clientHit = bestName(haystack, cat.clients);
  const projectHit = bestName(haystack, cat.projects);

  const action: ChatViewAction = { label: '' };
  const parts: string[] = [];

  // Resolve primary entity: explicit cues win, else highest score among catalogs
  type Cand = { kind: 'project' | 'client' | 'manager' | 'phase' | 'status'; name: string; score: number };
  const cands: Cand[] = [];
  if (projectHit) cands.push({ kind: 'project', name: projectHit, score: nameScore(haystack, projectHit) });
  if (clientHit) cands.push({ kind: 'client', name: clientHit, score: nameScore(haystack, clientHit) });
  if (managerHit) cands.push({ kind: 'manager', name: managerHit, score: nameScore(haystack, managerHit) });
  if (phaseHit) cands.push({ kind: 'phase', name: phaseHit, score: nameScore(haystack, phaseHit) });
  if (statusHit && (statusHit !== 'ACTIVE' || /\bactive\b/i.test(q))) {
    cands.push({
      kind: 'status',
      name: statusHit,
      score: nameScore(haystack, statusHit) || 200,
    });
  }

  cands.sort((a, b) => b.score - a.score);

  const pick = (kind: Cand['kind']) => cands.find((c) => c.kind === kind);

  if (wantsProject && pick('project')) {
    action.project = pick('project')!.name;
  } else if (wantsClient && pick('client')) {
    action.client = pick('client')!.name;
  } else if (wantsManager && pick('manager')) {
    action.manager = pick('manager')!.name;
  } else if (wantsPhase && pick('phase')) {
    action.phase = pick('phase')!.name;
  } else if (wantsStatus && pick('status')) {
    action.status = pick('status')!.name;
  } else if (cands[0]) {
    const top = cands[0];
    if (top.kind === 'project') action.project = top.name;
    else if (top.kind === 'client') action.client = top.name;
    else if (top.kind === 'manager') action.manager = top.name;
    else if (top.kind === 'phase') action.phase = top.name;
    else action.status = top.name;
  }

  // Layer secondary filters that still appear in the phrase
  if (!action.status && statusHit && /\bactive\b|\bcompleted\b|\binactive\b/i.test(q)) {
    action.status = statusHit;
  }
  if (!action.phase && phaseHit && (wantsPhase || nameScore(haystack, phaseHit) >= 1000)) {
    if (action.project || action.client || action.manager) action.phase = phaseHit;
  }
  if (!action.manager && managerHit && wantsManager) action.manager = managerHit;

  if (action.project) parts.push(`project **${action.project}**`);
  if (action.client) parts.push(`client **${action.client}**`);
  if (action.manager) parts.push(`manager **${action.manager}**`);
  if (action.phase) parts.push(`phase **${action.phase}**`);
  if (action.status) parts.push(`status **${action.status}**`);

  if (!parts.length) {
    return {
      label: `I couldn't match “${subject}” to a project, client, manager, phase, or status. Try a name from the Project List.`,
    };
  }

  action.label = `Filtered Main Report to ${parts.join(', ')}.`;
  return action;
}
