import { useMemo, useState } from 'react';
import { fmtPct, fmtUSD } from '../lib/format';
import type { DashboardData, ProjectRow } from '../lib/types';
import type { Profile } from '../lib/authTypes';

function progressPct(p: ProjectRow) {
  if (p.pct_billed != null && isFinite(p.pct_billed)) return Math.max(0, Math.min(1, p.pct_billed));
  if (p.contract > 0) return Math.max(0, Math.min(1, p.billed / p.contract));
  return 0;
}

function StatusBadge({ status }: { status: string | null }) {
  const s = (status || 'unknown').toLowerCase();
  return <span className={`badge ${s}`}>{status || '—'}</span>;
}

export function CustomerPortal({ data, profile }: { data: DashboardData; profile: Profile }) {
  const projects = useMemo(
    () =>
      data.projects
        .slice()
        .sort((a, b) => {
          const rank = (s: string | null) =>
            s === 'ACTIVE' ? 0 : s === 'HOLD' ? 1 : s === 'COMPLETED' ? 2 : 3;
          return rank(a.status) - rank(b.status) || a.project.localeCompare(b.project);
        }),
    [data.projects],
  );

  const [selected, setSelected] = useState<string | null>(null);
  const active = projects.find((p) => p.project === selected) || projects[0] || null;

  const summary = useMemo(() => {
    const activeN = projects.filter((p) => p.status === 'ACTIVE').length;
    const contract = projects.reduce((a, p) => a + (p.contract || 0), 0);
    const billed = projects.reduce((a, p) => a + (p.billed || 0), 0);
    return { activeN, contract, billed, total: projects.length };
  }, [projects]);

  if (!projects.length) {
    return (
      <main className="customer-portal">
        <div className="panel">
          <h3>No projects found</h3>
          <p style={{ color: 'var(--ink-soft)', fontSize: 13.5 }}>
            There are no projects linked to {profile.client_name || 'this account'} yet.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="customer-portal">
      <div className="customer-hero">
        <div>
          <p className="customer-kicker">Client portal</p>
          <h1 className="display">{profile.client_name || profile.display_name}</h1>
          <p className="customer-lede">
            Track status and billing progress across your active and completed work packages.
          </p>
        </div>
        <div className="customer-summary">
          <div>
            <span className="k">Projects</span>
            <span className="v">{summary.total}</span>
          </div>
          <div>
            <span className="k">Active</span>
            <span className="v">{summary.activeN}</span>
          </div>
          <div>
            <span className="k">Contract</span>
            <span className="v mono">{fmtUSD(summary.contract)}</span>
          </div>
          <div>
            <span className="k">Billed</span>
            <span className="v mono">{fmtUSD(summary.billed)}</span>
          </div>
        </div>
      </div>

      <div className="customer-layout">
        <div className="panel customer-list">
          <h3>
            Your projects <span className="tag">{projects.length}</span>
          </h3>
          <div className="customer-list-scroll">
            {projects.map((p) => {
              const pct = progressPct(p);
              const isSel = active?.project === p.project;
              return (
                <button
                  key={p.project}
                  type="button"
                  className={`customer-row ${isSel ? 'selected' : ''}`}
                  onClick={() => setSelected(p.project)}
                >
                  <div className="customer-row-top">
                    <span className="name">{p.project}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="customer-row-meta">
                    <span>{p.phase || '—'}</span>
                    <span className="mono">{fmtPct(pct)} billed</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${pct * 100}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {active ? (
          <div className="panel customer-detail">
            <h3>
              Project status <span className="tag">{active.status}</span>
            </h3>
            <h2 className="display customer-detail-title">{active.project}</h2>
            <div className="customer-detail-grid">
              <div>
                <span className="k">Phase</span>
                <span className="v">{active.phase || '—'}</span>
              </div>
              <div>
                <span className="k">Contract type</span>
                <span className="v">{active.type || '—'}</span>
              </div>
              <div>
                <span className="k">Project manager</span>
                <span className="v">{active.manager || '—'}</span>
              </div>
              <div>
                <span className="k">Status</span>
                <span className="v">
                  <StatusBadge status={active.status} />
                </span>
              </div>
            </div>

            <div className="customer-metrics">
              <div className="kpi">
                <div className="k">Contract</div>
                <div className="v">{fmtUSD(active.contract)}</div>
              </div>
              <div className="kpi accent-gold">
                <div className="k">Billed to date</div>
                <div className="v">{fmtUSD(active.billed)}</div>
              </div>
              <div className="kpi accent-teal">
                <div className="k">Spent</div>
                <div className="v">{fmtUSD(active.spent)}</div>
              </div>
              <div className="kpi">
                <div className="k">Receivable</div>
                <div className="v">{fmtUSD(active.ar)}</div>
              </div>
            </div>

            <div className="customer-progress-block">
              <div className="customer-progress-label">
                <span>Billing progress</span>
                <span className="mono">{fmtPct(progressPct(active))}</span>
              </div>
              <div className="progress-track tall">
                <div className="progress-fill" style={{ width: `${progressPct(active) * 100}%` }} />
              </div>
              <p className="customer-note">
                Figures reflect the latest Ajera/BQE export for your account. Contact your project
                manager for schedule or deliverable questions.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
