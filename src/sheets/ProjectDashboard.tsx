import { useEffect, useMemo, useState } from 'react';
import { ClientMeetingsPanel } from '../components/ClientMeetingsPanel';
import { ClientProjectBoard } from '../components/ClientProjectBoard';
import { DoughnutChart, GaugeRing, VBarChart } from '../components/Charts';
import { KpiRow } from '../components/KpiRow';
import { PlanSetsPanel } from '../components/PlanSetsPanel';
import { ProjectHoursBreakdown } from '../components/ProjectHoursBreakdown';
import { ScheduleDeadlineCalendar } from '../components/ScheduleDeadlineCalendar';
import { useAuth } from '../hooks/useAuth';
import {
  PROCESS_PHASES,
  matchProcessPhaseIndex,
  processPhaseLabel,
} from '../lib/architecturalProcess';
import { fmtPct, fmtUSD, monthLabel, palette } from '../lib/format';
import { phaseDisplayName } from '../lib/phaseAbbrev';
import { buildClientHierarchy, type ProjectNode } from '../lib/projectListHierarchy';
import { rowOutstanding } from '../lib/receivable';
import { groupScheduleSections, statusTone } from '../lib/scheduleSections';
import type { ScheduleRow } from '../lib/scheduleTypes';
import { supabase } from '../lib/supabase';
import type { DashboardData, ProjectRow } from '../lib/types';
import { ProjectSchedule } from './ProjectSchedule';

const STORAGE_KEY = 'pa-project-dashboard-key-v1';

function sum(rows: ProjectRow[], key: keyof ProjectRow) {
  return rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
}

function fmtHours(n: number) {
  if (!n) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function projectMatches(needle: string, hay: string | null | undefined) {
  if (!hay) return false;
  const a = needle.trim().toLowerCase();
  const b = hay.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function pickDefaultKey(projects: ProjectNode[], preferred?: string | null) {
  if (preferred && projects.some((p) => p.key === preferred)) return preferred;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && projects.some((p) => p.key === saved)) return saved;
  } catch {
    /* ignore */
  }
  return projects[0]?.key || '';
}

function CommPulse({
  projectKey,
  manager,
}: {
  projectKey: string;
  manager?: string | null;
}) {
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: scheds } = await supabase
        .from('pa_schedules')
        .select('id, project_key')
        .order('project_key');
      if (cancelled) return;
      const list = (scheds || []) as { id: string; project_key: string }[];
      const hit =
        list.find((s) => s.project_key === projectKey) ||
        list.find((s) => projectMatches(projectKey, s.project_key)) ||
        null;
      if (!hit) {
        setRows([]);
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from('pa_schedule_rows')
        .select('*')
        .eq('schedule_id', hit.id)
        .order('sort_order');
      if (cancelled) return;
      setRows((data || []) as ScheduleRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectKey]);

  const sections = useMemo(() => groupScheduleSections(rows), [rows]);
  const openThreads = useMemo(() => {
    const out: { section: string; row: ScheduleRow; kind: 'unanswered' | 'active' | 'replied' }[] =
      [];
    for (const s of sections) {
      for (const row of s.items) {
        const firm = row.mdesigns_comments.trim();
        const client = row.client_comments.trim();
        const active = statusTone(row.budget_remaining) === 'active';
        if (!firm && !client && !active) continue;
        const kind =
          firm && !client ? 'unanswered' : active ? 'active' : client ? 'replied' : 'active';
        out.push({ section: s.title, row, kind });
      }
    }
    out.sort((a, b) => {
      const rank = { unanswered: 0, active: 1, replied: 2 };
      return rank[a.kind] - rank[b.kind];
    });
    return out.slice(0, 12);
  }, [sections]);

  const counts = useMemo(() => {
    let unanswered = 0;
    let withClient = 0;
    let active = 0;
    for (const s of sections) {
      for (const row of s.items) {
        if (row.mdesigns_comments.trim() && !row.client_comments.trim()) unanswered += 1;
        if (row.client_comments.trim()) withClient += 1;
        if (statusTone(row.budget_remaining) === 'active') active += 1;
      }
    }
    return { unanswered, withClient, active, sections: sections.length };
  }, [sections]);

  if (loading) return <p className="pd-muted">Loading client communication…</p>;

  return (
    <div className="pd-comms">
      <div className="pd-comms-stats">
        <div>
          <span className="k">Awaiting client</span>
          <span className="v">{counts.unanswered}</span>
        </div>
        <div>
          <span className="k">Client replies</span>
          <span className="v">{counts.withClient}</span>
        </div>
        <div>
          <span className="k">Active items</span>
          <span className="v">{counts.active}</span>
        </div>
        <div>
          <span className="k">Schedule phases</span>
          <span className="v">{counts.sections}</span>
        </div>
      </div>
      {!openThreads.length ? (
        <p className="pd-muted">
          No open notes yet{manager ? ` — add M. Designs notes on the schedule for ${manager}’s client to see` : ''}.
        </p>
      ) : (
        <ul className="pd-thread-list">
          {openThreads.map(({ section, row, kind }) => (
            <li key={row.id} className={`pd-thread kind-${kind}`}>
              <div className="pd-thread-top">
                <span className="mono">{section}</span>
                <span className={`pd-chip ${kind}`}>
                  {kind === 'unanswered'
                    ? 'Needs client'
                    : kind === 'active'
                      ? 'Active'
                      : 'Client replied'}
                </span>
              </div>
              <strong>{row.task || 'Untitled'}</strong>
              {row.mdesigns_comments.trim() ? (
                <p className="pd-note firm">
                  <span>Firm</span>
                  {row.mdesigns_comments}
                </p>
              ) : null}
              {row.client_comments.trim() ? (
                <p className="pd-note client">
                  <span>Client</span>
                  {row.client_comments}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProjectDashboard({
  data,
  lockedEmployee,
}: {
  data: DashboardData;
  lockedEmployee?: string | null;
}) {
  const { profile } = useAuth();
  const [previewClient, setPreviewClient] = useState(false);
  const allProjects = useMemo(() => {
    const hierarchy = buildClientHierarchy(data.projects);
    let list = hierarchy.flatMap((c) =>
      c.projects.map((p) => ({ ...p, clientName: c.client })),
    );
    if (lockedEmployee) {
      list = list.filter(
        (p) =>
          p.row?.manager === lockedEmployee ||
          p.phases.some((ph) => ph.row.manager === lockedEmployee),
      );
    }
    return list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  }, [data.projects, lockedEmployee]);

  const [projectKey, setProjectKey] = useState('');

  useEffect(() => {
    setProjectKey((prev) => pickDefaultKey(allProjects, prev));
  }, [allProjects]);

  function selectProject(key: string) {
    setProjectKey(key);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      /* ignore */
    }
  }

  const project = allProjects.find((p) => p.key === projectKey) || null;
  const detailRows = useMemo(() => {
    if (!project) return [] as ProjectRow[];
    if (project.phases.length) return project.phases.map((p) => p.row);
    return project.row ? [project.row] : [];
  }, [project]);

  const header = project?.row || detailRows[0] || null;
  const clientName = project?.clientName || header?.client || '—';
  const manager = header?.manager || detailRows.find((r) => r.manager)?.manager || null;
  const status = header?.status || detailRows.find((r) => r.status)?.status || null;
  const city = header?.city || detailRows.find((r) => r.city)?.city || null;
  const type = header?.type || detailRows.find((r) => r.type)?.type || null;
  const phaseRaw = header?.phase || detailRows.find((r) => r.phase)?.phase || null;
  const phaseLabel = processPhaseLabel(phaseRaw);
  const phaseIdx = matchProcessPhaseIndex(phaseRaw);
  const process = phaseIdx >= 0 ? PROCESS_PHASES[phaseIdx] : null;

  const contract = project?.contract || sum(detailRows, 'contract');
  const billed = project?.billed || sum(detailRows, 'billed');
  const spent = sum(detailRows, 'spent') || (project?.row?.spent ?? 0);
  const profit = sum(detailRows, 'profit');
  const outstanding = project?.outstanding ?? detailRows.reduce((a, r) => a + rowOutstanding(r), 0);
  const billedHours = project?.billedHours || sum(detailRows, 'billed_hours' as keyof ProjectRow);
  const spentHours = project?.spentHours || sum(detailRows, 'spent_hours' as keyof ProjectRow);
  const retainerBal = sum(detailRows, 'retainer_balance');
  const remaining = Math.max(contract - billed, 0);
  const pctBilled = contract > 0 ? billed / contract : 0;
  const pctUsed = contract > 0 ? spent / contract : 0;
  const margin = billed > 0 ? profit / billed : null;

  const monthlyMap = useMemo(() => {
    const keys = [
      project?.key,
      ...(detailRows.map((r) => r.project) || []),
    ].filter(Boolean) as string[];
    const merged: Record<string, number> = {};
    for (const k of keys) {
      const m = data.project_monthly_billed[k];
      if (!m) continue;
      for (const [month, amt] of Object.entries(m)) {
        merged[month] = (merged[month] || 0) + (amt || 0);
      }
    }
    return merged;
  }, [data.project_monthly_billed, project, detailRows]);

  const monthlyLabels = useMemo(
    () => Object.keys(monthlyMap).sort().slice(-18),
    [monthlyMap],
  );
  const monthlyValues = monthlyLabels.map((m) => monthlyMap[m] || 0);

  const invoices = useMemo(() => {
    if (!project) return [];
    return data.invoice_ledger
      .filter(
        (inv) =>
          projectMatches(project.key, inv.p) ||
          projectMatches(project.title, inv.p) ||
          detailRows.some((r) => projectMatches(r.project, inv.p)) ||
          (clientName !== '—' && inv.c === clientName),
      )
      .sort((a, b) => String(b.d || '').localeCompare(String(a.d || '')))
      .slice(0, 40);
  }, [data.invoice_ledger, project, detailRows, clientName]);

  const invoiceTotal = invoices.reduce((a, r) => a + (r.b || 0), 0);
  const arClient = data.ar_clients.find((c) => c.client === clientName) || null;

  const phaseChart = useMemo(() => {
    if (!project?.phases.length) return null;
    const contract = project.phases.map((p) => p.row.contract || 0);
    const billed = project.phases.map((p) => p.row.billed || 0);
    return {
      labels: project.phases.map((p) => phaseDisplayName(p.row.phase, p.row.project) || p.label),
      contract,
      billed,
      /** Unbilled remainder so stacked bars total to contract. */
      remaining: contract.map((c, i) => Math.max(0, c - (billed[i] || 0))),
    };
  }, [project]);

  if (!allProjects.length) {
    return (
      <section className="sheet active">
        <div className="panel">
          <h3>Project dashboard</h3>
          <p className="pd-muted">No projects available for this account yet.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="sheet active project-dashboard">
      <div className="filters pd-toolbar">
        <span className="f-label">Project</span>
        <select
          value={projectKey}
          onChange={(e) => selectProject(e.target.value)}
          className="pd-project-select"
        >
          {allProjects.map((p) => (
            <option key={p.key} value={p.key}>
              {p.title}
              {p.code ? ` (${p.code})` : ''} — {p.clientName}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="pd-client-preview-btn"
          disabled={!project}
          onClick={() => setPreviewClient(true)}
        >
          Preview client portal
        </button>
        {lockedEmployee ? (
          <span className="f-label">Scoped to {lockedEmployee}</span>
        ) : (
          <span className="pd-toolbar-meta mono">
            {allProjects.length} projects · singular deep dive
          </span>
        )}
      </div>

      {project ? (
        <div className="pd-with-cal">
          <header className="pd-hero">
            <div>
              <p className="pd-kicker">Sheet A-4 · Project dashboard</p>
              <h1 className="display">{project.title}</h1>
              <p className="pd-hero-meta">
                <span>{clientName}</span>
                {project.code ? (
                  <>
                    <span className="dot">·</span>
                    <span className="mono">{project.code}</span>
                  </>
                ) : null}
                {city ? (
                  <>
                    <span className="dot">·</span>
                    <span>{city}</span>
                  </>
                ) : null}
                {type ? (
                  <>
                    <span className="dot">·</span>
                    <span>{type}</span>
                  </>
                ) : null}
                {manager ? (
                  <>
                    <span className="dot">·</span>
                    <span>PM {manager}</span>
                  </>
                ) : null}
              </p>
            </div>
            <div className="pd-hero-badges">
              {status ? (
                <span className={`badge ${(status || '').toLowerCase()}`}>{status}</span>
              ) : null}
              <div className="pd-phase-badge">
                <span className="k">Current phase</span>
                <span className="v">{phaseLabel}</span>
              </div>
            </div>
          </header>

          <KpiRow
            items={[
              { k: 'Contract', v: fmtUSD(contract), cls: 'accent-gold' },
              { k: 'Billed', v: fmtUSD(billed) },
              { k: 'Remaining', v: fmtUSD(remaining) },
              {
                k: 'Outstanding',
                v: fmtUSD(Math.max(0, outstanding)),
                cls: 'accent-rust',
              },
              { k: 'Spent', v: fmtUSD(spent) },
              {
                k: 'Profit',
                v: fmtUSD(profit),
                cls: profit >= 0 ? 'accent-green' : 'accent-rust',
              },
              { k: 'Billed hours', v: fmtHours(billedHours) },
              { k: 'Spent hours', v: fmtHours(spentHours) },
            ]}
          />

          <div className="pd-gauge-row">
            <div className="panel pd-gauge-card">
              <h3>
                % Billed <span className="tag">of contract</span>
              </h3>
              <div className="pd-gauge-wrap">
                <GaugeRing pct={pctBilled} color={palette.gold} />
              </div>
              <p className="pd-gauge-sub mono">{fmtPct(pctBilled)}</p>
            </div>
            <div className="panel pd-gauge-card">
              <h3>
                % Spent <span className="tag">of contract</span>
              </h3>
              <div className="pd-gauge-wrap">
                <GaugeRing pct={pctUsed} color={palette.teal} />
              </div>
              <p className="pd-gauge-sub mono">{fmtPct(pctUsed)}</p>
            </div>
            <div className="panel pd-gauge-card">
              <h3>
                Margin <span className="tag">profit / billed</span>
              </h3>
              <div className="pd-gauge-wrap">
                <GaugeRing
                  pct={margin == null ? 0 : Math.max(0, margin)}
                  color={margin != null && margin < 0 ? palette.rust : palette.green}
                />
              </div>
              <p className="pd-gauge-sub mono">
                {margin == null ? '—' : fmtPct(margin)}
                {retainerBal ? ` · Retainer ${fmtUSD(retainerBal)}` : ''}
              </p>
            </div>
            <div className="panel pd-gauge-card pd-process-card">
              <h3>
                Process{' '}
                <span className="tag">
                  {process
                    ? process.id === 'additional'
                      ? 'Add. Services'
                      : `${phaseIdx + 1}/${PROCESS_PHASES.filter((p) => p.id !== 'additional').length}`
                    : 'unmapped'}
                </span>
              </h3>
              {process ? (
                <>
                  <p className="pd-process-name">{process.name}</p>
                  <p className="pd-milestone mono">Milestone · {process.milestone}</p>
                </>
              ) : (
                <p className="pd-muted">Phase “{phaseRaw || '—'}” is not mapped to the firm process yet.</p>
              )}
            </div>
          </div>

          <div className="panel pd-finance-panel">
            <div className="pd-finance-grid">
              <div className="pd-fee-block">
                <h3>
                  Phase / fee <span className="tag">{detailRows.length}</span>
                </h3>
                <div className="table-scroll pd-fee-scroll">
                  <table className="data pd-fee-table">
                    <thead>
                      <tr>
                        <th>Phase</th>
                        <th>Status</th>
                        <th className="num">Contract</th>
                        <th className="num">Billed</th>
                        <th className="num">Out.</th>
                        <th className="num">Hrs</th>
                        <th className="num">Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailRows.map((r) => (
                        <tr key={r.project}>
                          <td>
                            <strong>{phaseDisplayName(r.phase, r.project)}</strong>
                          </td>
                          <td>
                            {r.status ? (
                              <span className={`badge ${(r.status || '').toLowerCase()}`}>
                                {r.status}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="num">{fmtUSD(r.contract || 0)}</td>
                          <td className="num">{fmtUSD(r.billed || 0)}</td>
                          <td className="num">{fmtUSD(rowOutstanding(r))}</td>
                          <td className="num">{fmtHours(r.billed_hours || 0)}</td>
                          <td className="num">{fmtUSD(r.profit || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}>
                          <strong>Totals</strong>
                        </td>
                        <td className="num">
                          <strong>{fmtUSD(contract)}</strong>
                        </td>
                        <td className="num">
                          <strong>{fmtUSD(billed)}</strong>
                        </td>
                        <td className="num">
                          <strong>{fmtUSD(Math.max(0, outstanding))}</strong>
                        </td>
                        <td className="num">
                          <strong>{fmtHours(billedHours)}</strong>
                        </td>
                        <td className="num">
                          <strong>{fmtUSD(profit)}</strong>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="pd-charts-panel">
                <h3>
                  Charts <span className="tag">by phase</span>
                </h3>
                <div className="pd-charts-grid">
                  <div className="pd-chart-cell pd-chart-doughnut">
                    <h4>Contract by phase</h4>
                    {phaseChart && phaseChart.labels.length ? (
                      <div className="chart-wrap pd-doughnut-wrap">
                        <DoughnutChart
                          labels={phaseChart.labels}
                          values={phaseChart.contract}
                          colors={[
                            palette.navy,
                            palette.gold,
                            palette.teal,
                            '#3A6EA5',
                            '#6B4C8A',
                            '#C47A5A',
                            '#4C6580',
                            '#8B6B8A',
                          ]}
                        />
                      </div>
                    ) : (
                      <p className="pd-muted">No phase lines to chart yet.</p>
                    )}
                  </div>

                  {phaseChart && phaseChart.labels.length > 1 ? (
                    <div className="pd-chart-cell">
                      <h4>Contract vs billed</h4>
                      <div className="chart-wrap pd-chart-bar">
                        <VBarChart
                          labels={phaseChart.labels}
                          stacked
                          datasets={[
                            {
                              label: 'Billed',
                              values: phaseChart.billed,
                              color: palette.gold,
                            },
                            {
                              label: 'Remaining',
                              values: phaseChart.remaining,
                              color: palette.navy,
                            },
                          ]}
                        />
                      </div>
                    </div>
                  ) : null}

                  <div
                    className={`pd-chart-cell${
                      !(phaseChart && phaseChart.labels.length > 1) ? ' pd-chart-wide' : ''
                    }`}
                  >
                    <h4>Monthly billed</h4>
                    {monthlyLabels.length ? (
                      <div className="chart-wrap pd-chart-bar">
                        <VBarChart
                          labels={monthlyLabels.map(monthLabel)}
                          datasets={[
                            {
                              label: 'Billed',
                              values: monthlyValues,
                              color: palette.gold,
                            },
                          ]}
                        />
                      </div>
                    ) : (
                      <p className="pd-muted">No monthly billed history for this project yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <ProjectHoursBreakdown
            projectTitle={project.title}
            projectFullName={project.key || project.row?.project || project.title}
            projectCode={project.code}
          />

          <div className="panel">
            <PlanSetsPanel projectKey={project.key} projectTitle={project.title} />
          </div>

          <div className="panel">
            <h3>
              Client communication <span className="tag">from schedule notes</span>
            </h3>
            <CommPulse projectKey={project.key} manager={manager} />
          </div>

          <div className="panel pd-meetings-panel">
            <ClientMeetingsPanel projectKey={project.key} clientName={clientName} />
          </div>

          <div className="panel pd-schedule-panel">
            <h3>
              Project schedule
              <span className="tag">list · gantt · roadmap · board</span>
            </h3>
            <ProjectSchedule
              mode="staff"
              preferredProjectKey={project.key}
              highlightPhase={phaseRaw}
              embedded
              lockProject
            />
          </div>

          <div className="panel pd-bottom-finance">
            <div className="pd-bottom-grid">
              <div>
                <h3>
                  Client A/R aging <span className="tag">{clientName}</span>
                </h3>
                {arClient ? (
                  <div className="pd-ar-grid">
                    <div>
                      <span className="k">Balance</span>
                      <span className="v">{fmtUSD(arClient.balance)}</span>
                    </div>
                    <div>
                      <span className="k">0–30</span>
                      <span className="v">{fmtUSD(arClient.d0_30)}</span>
                    </div>
                    <div>
                      <span className="k">31–60</span>
                      <span className="v">{fmtUSD(arClient.d31_60)}</span>
                    </div>
                    <div>
                      <span className="k">61–90</span>
                      <span className="v">{fmtUSD(arClient.d61_90)}</span>
                    </div>
                    <div>
                      <span className="k">91+</span>
                      <span className="v rust">{fmtUSD(arClient.d91_plus)}</span>
                    </div>
                    <div>
                      <span className="k">Credit</span>
                      <span className="v">{fmtUSD(arClient.credit)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="pd-muted">No A/R aging row matched “{clientName}”.</p>
                )}
              </div>

              <div className="pd-bottom-invoices">
                <h3>
                  Invoices <span className="tag">{invoices.length} · {fmtUSD(invoiceTotal)}</span>
                </h3>
                {invoices.length ? (
                  <div className="table-scroll pd-bottom-scroll">
                    <table className="data pd-fee-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Project</th>
                          <th className="num">#</th>
                          <th className="num">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoices.map((inv, i) => (
                          <tr key={`${inv.n}-${inv.d}-${i}`}>
                            <td className="mono">{inv.d || '—'}</td>
                            <td>{inv.p || '—'}</td>
                            <td className="num mono">{inv.n || '—'}</td>
                            <td className="num">{fmtUSD(inv.b || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="pd-muted">No invoice rows matched this project or client.</p>
                )}
              </div>
            </div>
          </div>

          {previewClient ? (
            <div className="pd-preview-overlay" role="dialog" aria-modal="true" aria-label="Client portal preview">
              <div className="pd-preview-shell">
                <div className="pd-preview-bar">
                  <div>
                    <strong>Client portal preview</strong>
                    <span className="mono">
                      {clientName} · messages sync to their login
                    </span>
                  </div>
                  <button type="button" className="pd-preview-close" onClick={() => setPreviewClient(false)}>
                    Close preview
                  </button>
                </div>
                <div className="pd-preview-body">
                  <ClientProjectBoard
                    mode="pm"
                    authorName={
                      profile?.employee_name ||
                      profile?.display_name ||
                      manager ||
                      'Project manager'
                    }
                    banner={`You are previewing ${clientName}’s portal. Send messages — they see the same board.`}
                    project={{
                      projectKey: project.key,
                      title: project.title,
                      clientName,
                      manager,
                      status,
                      city,
                      phase: phaseRaw,
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          <ScheduleDeadlineCalendar projectKey={project.key} corner />
        </div>
      ) : null}
    </section>
  );
}
