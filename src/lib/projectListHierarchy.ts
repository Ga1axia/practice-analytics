import { phaseDisplayName } from './phaseAbbrev';
import { rowOutstanding } from './receivable';
import type { ProjectRow } from './types';

export type PhaseNode = {
  row: ProjectRow;
  label: string;
};

export type ProjectNode = {
  key: string;
  title: string;
  code: string | null;
  row: ProjectRow | null;
  phases: PhaseNode[];
  contract: number;
  billed: number;
  outstanding: number;
  billedHours: number;
  spentHours: number;
};

export type ClientNode = {
  client: string;
  projects: ProjectNode[];
  /** True when the client has exactly one project — UI can skip the project tier. */
  singleProject: boolean;
  contract: number;
  billed: number;
  outstanding: number;
  phaseCount: number;
};

function projectCode(name: string): string | null {
  const m = name.match(/\b(\d{2}-\d{3})\b/);
  return m ? m[1] : null;
}

function projectTitle(name: string): string {
  return name.replace(/\s*-\s*\d{2}-\d{3}\s*$/, '').trim() || name;
}

function sumPhases(phases: PhaseNode[], key: keyof ProjectRow): number {
  return phases.reduce((a, p) => a + (Number(p.row[key]) || 0), 0);
}

/**
 * Group flat pa_projects rows into Client → Project → Phase.
 * Prefer explicit row_kind / parent_project; fall back to name heuristics.
 */
export function buildClientHierarchy(rows: ProjectRow[]): ClientNode[] {
  const sorted = rows.slice().sort((a, b) => {
    const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (so !== 0) return so;
    return (a.project || '').localeCompare(b.project || '');
  });

  const byClient = new Map<string, ProjectRow[]>();
  for (const row of sorted) {
    const client = (row.client || 'Unassigned').trim() || 'Unassigned';
    const list = byClient.get(client);
    if (list) list.push(row);
    else byClient.set(client, [row]);
  }

  const clients: ClientNode[] = [];

  for (const [client, clientRows] of byClient) {
    const projectRows = clientRows.filter(
      (r) => r.row_kind === 'project' || (!r.row_kind && /-\s*\d{2}-\d{3}\s*$/.test(r.project)),
    );
    const phaseRows = clientRows.filter((r) => !projectRows.includes(r));

    const projects: ProjectNode[] = [];
    const projectMap = new Map<string, ProjectNode>();

    for (const pr of projectRows) {
      const node: ProjectNode = {
        key: pr.project,
        title: projectTitle(pr.project),
        code: projectCode(pr.project),
        row: pr,
        phases: [],
        contract: pr.contract || 0,
        billed: pr.billed || 0,
        outstanding: rowOutstanding(pr),
        billedHours: pr.billed_hours || 0,
        spentHours: pr.spent_hours || 0,
      };
      projects.push(node);
      projectMap.set(pr.project, node);
    }

    // Orphan bucket when phases have no parent project
    let orphan: ProjectNode | null = null;
    const ensureOrphan = () => {
      if (orphan) return orphan;
      orphan = {
        key: `${client}::__orphan`,
        title: client,
        code: null,
        row: null,
        phases: [],
        contract: 0,
        billed: 0,
        outstanding: 0,
        billedHours: 0,
        spentHours: 0,
      };
      projects.push(orphan);
      return orphan;
    };

    for (const ph of phaseRows) {
      const label = phaseDisplayName(ph.phase, ph.project);
      const parentKey =
        ph.parent_project ||
        [...projectMap.keys()].find((k) => ph.project.startsWith(projectTitle(k))) ||
        null;
      const parent = (parentKey && projectMap.get(parentKey)) || null;
      const target = parent || (projects.length === 1 ? projects[0]! : ensureOrphan());
      target.phases.push({ row: ph, label });
    }

    // Prefer phase totals when the project header has zeros but phases have amounts
    for (const p of projects) {
      const phaseContract = sumPhases(p.phases, 'contract');
      const phaseBilled = sumPhases(p.phases, 'billed');
      const phaseOut = p.phases.reduce((a, x) => a + rowOutstanding(x.row), 0);
      const phaseBh = sumPhases(p.phases, 'billed_hours');
      const phaseSh = sumPhases(p.phases, 'spent_hours');
      if (!p.contract && phaseContract) p.contract = phaseContract;
      if (!p.billed && phaseBilled) p.billed = phaseBilled;
      if (!p.outstanding && phaseOut) p.outstanding = phaseOut;
      if (!p.billedHours && phaseBh) p.billedHours = phaseBh;
      if (!p.spentHours && phaseSh) p.spentHours = phaseSh;
    }

    // If no project headers, treat all phases as one synthetic project
    if (!projects.length && phaseRows.length) {
      const phases = phaseRows.map((ph) => ({
        row: ph,
        label: phaseDisplayName(ph.phase, ph.project),
      }));
      projects.push({
        key: `${client}::__all`,
        title: client,
        code: null,
        row: null,
        phases,
        contract: sumPhases(phases, 'contract'),
        billed: sumPhases(phases, 'billed'),
        outstanding: phases.reduce((a, x) => a + rowOutstanding(x.row), 0),
        billedHours: sumPhases(phases, 'billed_hours'),
        spentHours: sumPhases(phases, 'spent_hours'),
      });
    }

    projects.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

    const phaseCount = projects.reduce((a, p) => a + p.phases.length, 0);
    clients.push({
      client,
      projects,
      singleProject: projects.length <= 1,
      contract: projects.reduce((a, p) => a + p.contract, 0),
      billed: projects.reduce((a, p) => a + p.billed, 0),
      outstanding: projects.reduce((a, p) => a + p.outstanding, 0),
      phaseCount,
    });
  }

  return clients.sort((a, b) => a.client.localeCompare(b.client, undefined, { sensitivity: 'base' }));
}
