import * as XLSX from 'xlsx';
import type { ProjectRow } from './types';

/** Project code suffix like "26-005" or "ID - Name - 26-024". */
const PROJECT_CODE_RE = /-\s*\d{2}-\d{3}\s*$/;

export type ParsedProjectList = {
  rows: ProjectRow[];
  clients: number;
  projects: number;
  phases: number;
};

function cellStr(v: unknown): string {
  if (v == null) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

/** Parse currency cells: $63,220.00 / ($3,500.00) / 0.00 */
export function parseMoney(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = cellStr(v);
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || s.includes('(');
  const n = Number(s.replace(/[$,()\s]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return neg ? -Math.abs(n) : n;
}

export function parseHours(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = cellStr(v);
  if (!s) return 0;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function isProjectCodeRow(name: string): boolean {
  return PROJECT_CODE_RE.test(name);
}

/** Extract phase label from "Client Name - Phase Name". */
export function extractPhaseLabel(projectName: string): string {
  const parts = projectName.split(' - ');
  if (parts.length < 2) return projectName;
  return parts.slice(1).join(' - ').trim() || projectName;
}

function findSheet(wb: XLSX.WorkBook): XLSX.WorkSheet {
  const preferred = wb.SheetNames.find((n) => /project\s*list/i.test(n));
  const name = preferred || wb.SheetNames[0];
  if (!name) throw new Error('Workbook has no sheets');
  return wb.Sheets[name];
}

function findHeaderRow(matrix: unknown[][]): number {
  for (let i = 0; i < Math.min(matrix.length, 40); i++) {
    const row = matrix[i] || [];
    const b = cellStr(row[1]).toUpperCase();
    const c = cellStr(row[2]).toUpperCase();
    if (b === 'PROJECT' && c.includes('CLIENT')) return i;
  }
  throw new Error(
    'Could not find header row (expected PROJECT / CLIENT - COMPANY\\NAME). Is this a Project List export?',
  );
}

/**
 * Parse an Ajera/BQE-style Project List.xlsx into pa_projects rows.
 * Hierarchy: client header → project (code) → phase rows.
 */
export function parseProjectListWorkbook(data: ArrayBuffer): ParsedProjectList {
  const wb = XLSX.read(data, { type: 'array', cellDates: false });
  const sheet = findSheet(wb);
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });

  const headerIdx = findHeaderRow(matrix);
  const rows: ProjectRow[] = [];
  let clients = 0;
  let projects = 0;
  let phases = 0;

  let currentClient = '';
  let currentParent: string | null = null;
  let sortOrder = 0;

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i] || [];
    const project = cellStr(row[1]);
    if (!project) continue;

    const clientCell = cellStr(row[2]);
    const manager = cellStr(row[3]);
    const billedHours = parseHours(row[4]);
    const spentHours = parseHours(row[5]);
    const billed = parseMoney(row[6]);
    const contract = parseMoney(row[7]);
    const outstanding = parseMoney(row[8]);

    // Client group header: name only, no manager / client column
    if (!clientCell && !manager) {
      currentClient = project;
      currentParent = null;
      clients += 1;
      continue;
    }

    const client =
      currentClient ||
      clientCell.replace(/\s*-\s*[^-]+$/, '').trim() ||
      clientCell;

    const isProject = isProjectCodeRow(project);
    const phaseLabel = isProject ? 'Other' : extractPhaseLabel(project);

    if (isProject) {
      currentParent = project;
      projects += 1;
    } else {
      phases += 1;
    }

    const pctBilled = contract > 0 ? billed / contract : null;

    rows.push({
      project,
      client,
      city: null,
      manager: manager || null,
      status: 'ACTIVE',
      type: null,
      phase: phaseLabel,
      contract,
      spent: billed,
      billed,
      pct_used: null,
      pct_billed: pctBilled,
      retainer_paid: 0,
      retainer_balance: 0,
      ar: outstanding,
      profit: 0,
      margin: null,
      row_kind: isProject ? 'project' : 'phase',
      parent_project: isProject ? null : currentParent,
      billed_hours: billedHours,
      spent_hours: spentHours,
      contract_outstanding: outstanding,
      sort_order: sortOrder++,
    });
  }

  if (!rows.length) {
    throw new Error('No project or phase rows found in the spreadsheet.');
  }

  return { rows, clients, projects, phases };
}

export async function parseProjectListFile(file: File): Promise<ParsedProjectList> {
  const buf = await file.arrayBuffer();
  return parseProjectListWorkbook(buf);
}
