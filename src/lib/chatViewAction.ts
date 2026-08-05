import type { DashboardData, ProjectRow } from './types';

/** Hidden / AI-driven metric filters on Main Report (not shown as permanent dropdowns). */
export type AiMetricFilters = {
  profitSign: 'positive' | 'negative' | null;
  marginMin: number | null;
  marginMax: number | null;
  /** Billing progress: billed / contract (0–1). */
  billingMin: number | null;
  billingMax: number | null;
  /** Burn / budget used: spent / contract (0–1). */
  burnMin: number | null;
  burnMax: number | null;
  contractMin: number | null;
  contractMax: number | null;
  overBudget: boolean;
  underBudget: boolean;
};

export const EMPTY_AI_FILTERS: AiMetricFilters = {
  profitSign: null,
  marginMin: null,
  marginMax: null,
  billingMin: null,
  billingMax: null,
  burnMin: null,
  burnMax: null,
  contractMin: null,
  contractMax: null,
  overBudget: false,
  underBudget: false,
};

/** Filters the AI can push onto Main Report / analysis views. */
export type ChatViewAction = {
  clear?: boolean;
  project?: string;
  client?: string;
  manager?: string;
  /** Phase name (SD, DD, CA…). */
  phase?: string;
  /** @deprecated Prefer projectStatus; kept for older callers. */
  status?: string;
  projectStatus?: string;
  phaseStatus?: string;
  profitSign?: 'positive' | 'negative' | 'any';
  marginMin?: number | null;
  marginMax?: number | null;
  billingMin?: number | null;
  billingMax?: number | null;
  burnMin?: number | null;
  burnMax?: number | null;
  contractMin?: number | null;
  contractMax?: number | null;
  overBudget?: boolean | null;
  underBudget?: boolean | null;
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
  'leading', 'lead', 'phase', 'status', 'active', 'completed', 'negative',
  'positive', 'profitable', 'unprofitable', 'budget', 'progress', 'burn',
]);

const FILTER_RE =
  /^(?:show|filter|find|focus|open|display|list)\s+(?:me\s+|only\s+|just\s+)?(.+)$/i;
const CLEAR_RE =
  /^(?:clear(?:\s+filters?)?|reset(?:\s+filters?)?|show\s+all(?:\s+projects?)?|all\s+projects?)\s*[.!?]?$/i;

const METRIC_HINT_RE =
  /\b(unprofitable|profitable|negative\s+profit|positive\s+profit|margin|billing(?:\s+progress)?|burn(?:\s+rate)?|over[\s-]?budget|under[\s-]?budget|contract(?:\s+(?:value|amount|size))?)\b/i;

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
    statuses: statuses.length ? statuses : ['ACTIVE', 'COMPLETED'],
  };
}

function parseMoney(raw: string, unit?: string | null): number | null {
  const n = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const u = (unit || '').toLowerCase();
  if (u === 'k' || u === 'thousand') return n * 1e3;
  if (u === 'm' || u === 'million') return n * 1e6;
  return n;
}

function parsePct(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

/** Pull metric intents from a filter command. */
export function parseMetricIntents(q: string): Partial<ChatViewAction> {
  const out: Partial<ChatViewAction> = {};

  if (/\b(unprofitable|negative\s+profit|losing\s+money|in\s+the\s+red|loss(?:es)?)\b/i.test(q)) {
    out.profitSign = 'negative';
  } else if (/\b(profitable|positive\s+profit|in\s+the\s+black|making\s+money)\b/i.test(q)) {
    out.profitSign = 'positive';
  } else if (/\bany\s+profit\b|\bclear\s+profit\b/i.test(q)) {
    out.profitSign = 'any';
  }

  const marginAbove = q.match(
    /margin\s+(?:above|over|greater\s+than|at\s+least|>\s*)\s*(\d+(?:\.\d+)?)\s*%?/i,
  );
  const marginBelow = q.match(
    /margin\s+(?:below|under|less\s+than|at\s+most|<\s*)\s*(\d+(?:\.\d+)?)\s*%?/i,
  );
  if (marginAbove) out.marginMin = parsePct(marginAbove[1]!);
  if (marginBelow) out.marginMax = parsePct(marginBelow[1]!);

  const billAbove = q.match(
    /(?:billing(?:\s+progress)?|pct\s*billed|percent\s*billed|\bbilled)\s+(?:above|over|greater\s+than|at\s+least|>\s*)\s*(\d+(?:\.\d+)?)\s*%?/i,
  );
  const billBelow = q.match(
    /(?:billing(?:\s+progress)?|pct\s*billed|percent\s*billed|\bbilled)\s+(?:below|under|less\s+than|at\s+most|<\s*)\s*(\d+(?:\.\d+)?)\s*%?/i,
  );
  if (billAbove) out.billingMin = parsePct(billAbove[1]!);
  if (billBelow) out.billingMax = parsePct(billBelow[1]!);

  const burnAbove = q.match(
    /(?:burn(?:\s+rate)?|budget\s+used|spent\s+pct|percent\s*used)\s+(?:above|over|greater\s+than|at\s+least|>\s*)\s*(\d+(?:\.\d+)?)\s*%?/i,
  );
  const burnBelow = q.match(
    /(?:burn(?:\s+rate)?|budget\s+used|spent\s+pct|percent\s*used)\s+(?:below|under|less\s+than|at\s+most|<\s*)\s*(\d+(?:\.\d+)?)\s*%?/i,
  );
  if (burnAbove) out.burnMin = parsePct(burnAbove[1]!);
  if (burnBelow) out.burnMax = parsePct(burnBelow[1]!);

  const contractOver = q.match(
    /contracts?(?:\s+(?:value|amount|size))?\s+(?:over|above|greater\s+than|at\s+least|more\s+than|>\s*)\s*\$?\s*([\d,.]+)\s*(k|m|million|thousand)?/i,
  );
  const contractUnder = q.match(
    /contracts?(?:\s+(?:value|amount|size))?\s+(?:under|below|less\s+than|at\s+most|<\s*)\s*\$?\s*([\d,.]+)\s*(k|m|million|thousand)?/i,
  );
  if (contractOver) {
    const v = parseMoney(contractOver[1]!, contractOver[2]);
    if (v != null) out.contractMin = v;
  }
  if (contractUnder) {
    const v = parseMoney(contractUnder[1]!, contractUnder[2]);
    if (v != null) out.contractMax = v;
  }

  if (/\bover[\s-]?budget\b/i.test(q)) out.overBudget = true;
  if (/\bunder[\s-]?budget\b/i.test(q)) out.underBudget = true;

  return out;
}

export function chatViewActionHasEffect(a: ChatViewAction): boolean {
  if (a.clear) return true;
  if (a.project || a.client || a.manager || a.phase || a.status || a.projectStatus || a.phaseStatus) {
    return true;
  }
  if (a.profitSign) return true;
  if (a.marginMin != null || a.marginMax != null) return true;
  if (a.billingMin != null || a.billingMax != null) return true;
  if (a.burnMin != null || a.burnMax != null) return true;
  if (a.contractMin != null || a.contractMax != null) return true;
  if (a.overBudget || a.underBudget) return true;
  return false;
}

export function mergeAiFilters(
  prev: AiMetricFilters,
  a: ChatViewAction,
): AiMetricFilters {
  const next = { ...prev };
  if (a.profitSign === 'any') next.profitSign = null;
  else if (a.profitSign === 'positive' || a.profitSign === 'negative') {
    next.profitSign = a.profitSign;
  }
  if (a.marginMin !== undefined) next.marginMin = a.marginMin;
  if (a.marginMax !== undefined) next.marginMax = a.marginMax;
  if (a.billingMin !== undefined) next.billingMin = a.billingMin;
  if (a.billingMax !== undefined) next.billingMax = a.billingMax;
  if (a.burnMin !== undefined) next.burnMin = a.burnMin;
  if (a.burnMax !== undefined) next.burnMax = a.burnMax;
  if (a.contractMin !== undefined) next.contractMin = a.contractMin;
  if (a.contractMax !== undefined) next.contractMax = a.contractMax;
  if (a.overBudget === true) {
    next.overBudget = true;
    next.underBudget = false;
  } else if (a.overBudget === false) next.overBudget = false;
  if (a.underBudget === true) {
    next.underBudget = true;
    next.overBudget = false;
  } else if (a.underBudget === false) next.underBudget = false;
  return next;
}

export function aiFiltersActive(f: AiMetricFilters): boolean {
  return (
    f.profitSign != null ||
    f.marginMin != null ||
    f.marginMax != null ||
    f.billingMin != null ||
    f.billingMax != null ||
    f.burnMin != null ||
    f.burnMax != null ||
    f.contractMin != null ||
    f.contractMax != null ||
    f.overBudget ||
    f.underBudget
  );
}

function fmtPctLabel(n: number) {
  return `${Math.round(n * 100)}%`;
}

function fmtMoneyLabel(n: number) {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

export type AiFilterChip = {
  id: string;
  label: string;
  /** Patch applied on dismiss (merged onto current filters). */
  clear: Partial<AiMetricFilters>;
};

export function aiFilterChips(f: AiMetricFilters): AiFilterChip[] {
  const chips: AiFilterChip[] = [];
  if (f.profitSign === 'negative') {
    chips.push({ id: 'profit-', label: 'negative profit', clear: { profitSign: null } });
  }
  if (f.profitSign === 'positive') {
    chips.push({ id: 'profit+', label: 'positive profit', clear: { profitSign: null } });
  }
  if (f.marginMin != null) {
    chips.push({
      id: 'marginMin',
      label: `margin ≥ ${fmtPctLabel(f.marginMin)}`,
      clear: { marginMin: null },
    });
  }
  if (f.marginMax != null) {
    chips.push({
      id: 'marginMax',
      label: `margin ≤ ${fmtPctLabel(f.marginMax)}`,
      clear: { marginMax: null },
    });
  }
  if (f.billingMin != null) {
    chips.push({
      id: 'billingMin',
      label: `billing ≥ ${fmtPctLabel(f.billingMin)}`,
      clear: { billingMin: null },
    });
  }
  if (f.billingMax != null) {
    chips.push({
      id: 'billingMax',
      label: `billing ≤ ${fmtPctLabel(f.billingMax)}`,
      clear: { billingMax: null },
    });
  }
  if (f.burnMin != null) {
    chips.push({
      id: 'burnMin',
      label: `burn ≥ ${fmtPctLabel(f.burnMin)}`,
      clear: { burnMin: null },
    });
  }
  if (f.burnMax != null) {
    chips.push({
      id: 'burnMax',
      label: `burn ≤ ${fmtPctLabel(f.burnMax)}`,
      clear: { burnMax: null },
    });
  }
  if (f.contractMin != null) {
    chips.push({
      id: 'contractMin',
      label: `contract ≥ ${fmtMoneyLabel(f.contractMin)}`,
      clear: { contractMin: null },
    });
  }
  if (f.contractMax != null) {
    chips.push({
      id: 'contractMax',
      label: `contract ≤ ${fmtMoneyLabel(f.contractMax)}`,
      clear: { contractMax: null },
    });
  }
  if (f.overBudget) {
    chips.push({ id: 'overBudget', label: 'over budget', clear: { overBudget: false } });
  }
  if (f.underBudget) {
    chips.push({ id: 'underBudget', label: 'under budget', clear: { underBudget: false } });
  }
  return chips;
}

export function describeAiFilters(f: AiMetricFilters): string[] {
  return aiFilterChips(f).map((c) => c.label);
}

export function passesAiMetricFilters(
  metrics: {
    profit: number;
    margin: number | null;
    billingPct: number | null;
    burnPct: number | null;
    contract: number;
  },
  f: AiMetricFilters,
): boolean {
  if (f.profitSign === 'positive' && !(metrics.profit > 0)) return false;
  if (f.profitSign === 'negative' && !(metrics.profit < 0)) return false;
  if (f.marginMin != null && (metrics.margin == null || metrics.margin < f.marginMin)) {
    return false;
  }
  if (f.marginMax != null && (metrics.margin == null || metrics.margin > f.marginMax)) {
    return false;
  }
  if (
    f.billingMin != null &&
    (metrics.billingPct == null || metrics.billingPct < f.billingMin)
  ) {
    return false;
  }
  if (
    f.billingMax != null &&
    (metrics.billingPct == null || metrics.billingPct > f.billingMax)
  ) {
    return false;
  }
  if (f.burnMin != null && (metrics.burnPct == null || metrics.burnPct < f.burnMin)) {
    return false;
  }
  if (f.burnMax != null && (metrics.burnPct == null || metrics.burnPct > f.burnMax)) {
    return false;
  }
  if (f.contractMin != null && metrics.contract < f.contractMin) return false;
  if (f.contractMax != null && metrics.contract > f.contractMax) return false;
  if (f.overBudget && !(metrics.burnPct != null && metrics.burnPct > 1)) return false;
  if (f.underBudget && !(metrics.burnPct != null && metrics.burnPct < 1)) return false;
  return true;
}

function metricParts(a: ChatViewAction): string[] {
  const f = mergeAiFilters(EMPTY_AI_FILTERS, a);
  return describeAiFilters(f).map((p) => `**${p}**`);
}

/** True when the question is asking to change the visible filter, not just ask a fact. */
export function looksLikeViewCommand(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (CLEAR_RE.test(q)) return true;
  if (FILTER_RE.test(q)) return true;
  return false;
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
  const metrics = parseMetricIntents(q);
  const hasMetrics = Object.keys(metrics).length > 0 || METRIC_HINT_RE.test(q);

  const wantsManager = /\b(manager|managed\s+by|lead|pm)\b/i.test(q);
  const wantsClient = /\bclient\b/i.test(q);
  const wantsPhaseStatus =
    /\bphase\s+status\b/i.test(q) ||
    /\b(active|completed|inactive)\s+phases?\b/i.test(q) ||
    /\bphases?\s+(?:that\s+are\s+)?(active|completed|inactive)\b/i.test(q);
  const wantsPhaseName = /\bphase\b/i.test(q) && !wantsPhaseStatus;
  const wantsProjectStatus =
    /\bproject\s+status\b/i.test(q) ||
    /\b(active|completed|inactive)\s+projects?\b/i.test(q);
  const wantsStatusWord =
    /\b(active|completed|inactive)\b/i.test(q) && !METRIC_HINT_RE.test(q);
  const wantsProject =
    /\bproject\b/i.test(q) && !wantsProjectStatus && !METRIC_HINT_RE.test(q);

  const statusHit =
    bestName(haystack, cat.statuses) ||
    (/^active\b/i.test(subject) || /\bactive\b/i.test(q)
      ? 'ACTIVE'
      : /\bcompleted\b/i.test(q)
        ? 'COMPLETED'
        : /\binactive\b/i.test(q)
          ? 'INACTIVE'
          : null);
  const phaseHit = bestName(haystack, cat.phases);
  const managerHit = bestName(haystack, cat.managers);
  const clientHit = bestName(haystack, cat.clients);
  const projectHit = bestName(haystack, cat.projects);

  const action: ChatViewAction = { label: '', ...metrics };
  const parts: string[] = [];

  type Cand = {
    kind: 'project' | 'client' | 'manager' | 'phase' | 'status';
    name: string;
    score: number;
  };
  const cands: Cand[] = [];
  if (projectHit) {
    cands.push({ kind: 'project', name: projectHit, score: nameScore(haystack, projectHit) });
  }
  if (clientHit) {
    cands.push({ kind: 'client', name: clientHit, score: nameScore(haystack, clientHit) });
  }
  if (managerHit) {
    cands.push({ kind: 'manager', name: managerHit, score: nameScore(haystack, managerHit) });
  }
  if (phaseHit) {
    cands.push({ kind: 'phase', name: phaseHit, score: nameScore(haystack, phaseHit) });
  }
  if (statusHit && (statusHit !== 'ACTIVE' || /\bactive\b/i.test(q))) {
    cands.push({
      kind: 'status',
      name: statusHit,
      score: nameScore(haystack, statusHit) || 200,
    });
  }

  cands.sort((a, b) => b.score - a.score);
  const pick = (kind: Cand['kind']) => cands.find((c) => c.kind === kind);

  // Status words → project vs phase status (not a named entity)
  if (statusHit && (wantsPhaseStatus || wantsProjectStatus || wantsStatusWord)) {
    if (wantsPhaseStatus && !wantsProjectStatus) {
      action.phaseStatus = statusHit;
    } else if (wantsProjectStatus || (!wantsPhaseStatus && wantsStatusWord)) {
      // Default ACTIVE/COMPLETED language → project status
      action.projectStatus = statusHit;
    }
  }

  if (wantsProject && pick('project')) {
    action.project = pick('project')!.name;
  } else if (wantsClient && pick('client')) {
    action.client = pick('client')!.name;
  } else if (wantsManager && pick('manager')) {
    action.manager = pick('manager')!.name;
  } else if (wantsPhaseName && pick('phase') && !wantsPhaseStatus) {
    action.phase = pick('phase')!.name;
  } else if (!action.projectStatus && !action.phaseStatus && cands[0]) {
    const top = cands[0];
    // Weak name matches should not override metric-only commands
    if (hasMetrics && top.score < 1000) {
      /* keep metrics only */
    } else if (top.kind === 'project') action.project = top.name;
    else if (top.kind === 'client') action.client = top.name;
    else if (top.kind === 'manager') action.manager = top.name;
    else if (top.kind === 'phase') action.phase = top.name;
    else if (top.kind === 'status' && !hasMetrics) {
      action.projectStatus = top.name;
    }
  }

  if (
    !action.projectStatus &&
    !action.phaseStatus &&
    statusHit &&
    /\bactive\b|\bcompleted\b|\binactive\b/i.test(q) &&
    !hasMetrics
  ) {
    action.projectStatus = statusHit;
  }
  if (!action.phase && phaseHit && (wantsPhaseName || nameScore(haystack, phaseHit) >= 1000)) {
    if (action.project || action.client || action.manager || action.projectStatus) {
      action.phase = phaseHit;
    }
  }
  if (!action.manager && managerHit && wantsManager) action.manager = managerHit;

  // Backward-compat mirror
  if (action.projectStatus) action.status = action.projectStatus;

  if (action.project) parts.push(`project **${action.project}**`);
  if (action.client) parts.push(`client **${action.client}**`);
  if (action.manager) parts.push(`manager **${action.manager}**`);
  if (action.phase) parts.push(`phase **${action.phase}**`);
  if (action.projectStatus) parts.push(`project status **${action.projectStatus}**`);
  if (action.phaseStatus) parts.push(`phase status **${action.phaseStatus}**`);
  parts.push(...metricParts(action));

  if (!parts.length) {
    return {
      label: `I couldn't match “${subject}” to a project, client, manager, phase, status, or metric filter. Try e.g. “show me unprofitable projects” or “show me contracts over $500k”.`,
    };
  }

  action.label = `Filtered Main Report to ${parts.join(', ')}.`;
  return action;
}
