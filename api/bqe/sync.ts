import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  bqeListAll,
  mapBqeContractType,
  mapBqeStatus,
  serviceSupabase,
  type BqeProject,
} from '../_lib/bqe';
import { requireAdmin } from '../_lib/requireAdmin';

type ProjectInsert = {
  project: string;
  client: string | null;
  city: string | null;
  manager: string | null;
  status: string;
  type: string | null;
  phase: string;
  contract: number;
  spent: number;
  billed: number;
  pct_used: null;
  pct_billed: null;
  retainer_paid: number;
  retainer_balance: number;
  ar: number;
  profit: number;
  margin: null;
  row_kind: 'project' | 'phase';
  parent_project: string | null;
  billed_hours: null;
  spent_hours: null;
  contract_outstanding: null;
  sort_order: number;
};

function displayOf(p: BqeProject): string {
  return (p.displayName || p.name || p.code || 'Untitled').trim() || 'Untitled';
}

/** Allocate a unique `project` key (pa_projects.project is UNIQUE). */
function allocateUnique(base: string, id: string, used: Set<string>): string {
  const clean = base.replace(/\s+/g, ' ').trim() || 'Untitled';
  if (!used.has(clean)) {
    used.add(clean);
    return clean;
  }
  const withCode = id ? `${clean} [${id.slice(0, 8)}]` : clean;
  if (!used.has(withCode)) {
    used.add(withCode);
    return withCode;
  }
  let n = 2;
  for (;;) {
    const candidate = `${clean} (${n})`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    n += 1;
  }
}

function mapCoreProjects(projects: BqeProject[]): ProjectInsert[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const used = new Set<string>();
  const idToKey = new Map<string, string>();

  // Roots first so phase parent_project can point at the uniquified parent key
  const roots = projects.filter((p) => !p.parentId || !byId.has(p.parentId));
  const phases = projects.filter((p) => p.parentId && byId.has(p.parentId));

  const rows: ProjectInsert[] = [];
  let sort = 0;

  for (const p of roots) {
    const key = allocateUnique(displayOf(p), p.id, used);
    idToKey.set(p.id, key);
    const city =
      Array.isArray(p.address) && p.address[0]?.city ? String(p.address[0].city) : null;
    rows.push({
      project: key,
      client: p.client || null,
      city,
      manager: p.manager || null,
      status: mapBqeStatus(p.status),
      type: mapBqeContractType(p.contractType),
      phase: 'Other',
      contract: Number(p.contractAmount ?? p.serviceContract ?? 0) || 0,
      spent: 0,
      billed: 0,
      pct_used: null,
      pct_billed: null,
      retainer_paid: 0,
      retainer_balance: 0,
      ar: 0,
      profit: 0,
      margin: null,
      row_kind: 'project',
      parent_project: null,
      billed_hours: null,
      spent_hours: null,
      contract_outstanding: null,
      sort_order: sort++,
    });
  }

  for (const p of phases) {
    const parent = byId.get(p.parentId!)!;
    const parentKey = idToKey.get(parent.id) || displayOf(parent);
    const phaseName = (p.phaseDescription || p.phaseName || displayOf(p)).trim() || 'Phase';
    const base = `${parentKey} - ${phaseName}`;
    const key = allocateUnique(base, p.id, used);
    idToKey.set(p.id, key);
    const city =
      Array.isArray(p.address) && p.address[0]?.city
        ? String(p.address[0].city)
        : Array.isArray(parent.address) && parent.address[0]?.city
          ? String(parent.address[0].city)
          : null;
    rows.push({
      project: key,
      client: p.client || parent.client || null,
      city,
      manager: p.manager || parent.manager || null,
      status: mapBqeStatus(p.status ?? parent.status),
      type: mapBqeContractType(p.contractType ?? parent.contractType),
      phase: phaseName,
      contract: Number(p.contractAmount ?? p.serviceContract ?? 0) || 0,
      spent: 0,
      billed: 0,
      pct_used: null,
      pct_billed: null,
      retainer_paid: 0,
      retainer_balance: 0,
      ar: 0,
      profit: 0,
      margin: null,
      row_kind: 'phase',
      parent_project: parentKey,
      billed_hours: null,
      spent_hours: null,
      contract_outstanding: null,
      sort_order: sort++,
    });
  }

  return rows;
}

async function replaceProjects(
  sb: ReturnType<typeof serviceSupabase>,
  rows: ProjectInsert[],
): Promise<number> {
  // Hard clear — service role bypasses RLS
  const { error: delErr } = await sb.from('pa_projects').delete().gte('id', 0);
  if (delErr) throw new Error(`Clear projects failed: ${delErr.message}`);

  if (!rows.length) return 0;

  // Insert in chunks (PostgREST payload limits)
  const chunkSize = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error: insErr } = await sb.from('pa_projects').insert(chunk);
    if (insErr) throw new Error(`Insert projects failed: ${insErr.message}`);
    inserted += chunk.length;
  }
  return inserted;
}

/**
 * Replace pa_projects entirely from BQE CORE /project (no Excel / seed merge).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const sb = serviceSupabase();
  try {
    const projects = await bqeListAll<BqeProject>('/project', 100);
    const rows = mapCoreProjects(projects);
    const inserted = await replaceProjects(sb, rows);

    const msg =
      projects.length === 0
        ? 'BQE CORE returned 0 projects — local project list cleared.'
        : `Replaced project list with ${inserted} rows from BQE CORE (${projects.length} CORE records).`;

    await sb
      .from('pa_bqe_connection')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'ok',
        last_sync_message: msg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);

    res.status(200).json({
      ok: true,
      coreProjects: projects.length,
      rows: rows.length,
      inserted,
      message: msg,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'sync failed';
    try {
      await sb
        .from('pa_bqe_connection')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: 'error',
          last_sync_message: msg.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);
    } catch {
      /* ignore */
    }
    res.status(500).json({ error: msg });
  }
}
