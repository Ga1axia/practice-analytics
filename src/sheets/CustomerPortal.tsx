import { useMemo } from 'react';
import type { DashboardData, ProjectRow } from '../lib/types';
import type { Profile } from '../lib/authTypes';

const PHASE_STEPS = [
  'Pre-Design',
  'Schematic Design',
  'Design Development',
  'Construction Documents',
  'Permitting',
  'Construction Support',
];

function StatusBadge({ status }: { status: string | null }) {
  const s = (status || 'unknown').toLowerCase();
  return <span className={`badge ${s}`}>{status || '—'}</span>;
}

function normalizePhase(phase: string | null) {
  if (!phase) return null;
  const p = phase.trim().toLowerCase();
  const hit = PHASE_STEPS.find((step) => p.includes(step.toLowerCase()));
  return hit || phase;
}

function phaseIndex(phase: string | null) {
  const n = normalizePhase(phase);
  if (!n) return -1;
  return PHASE_STEPS.findIndex((step) => step.toLowerCase() === n.toLowerCase());
}

function pickProject(projects: ProjectRow[]) {
  if (!projects.length) return null;
  const active = projects.filter((p) => p.status === 'ACTIVE');
  const pool = active.length ? active : projects;
  return pool.slice().sort((a, b) => a.project.localeCompare(b.project))[0];
}

export function CustomerPortal({ data, profile }: { data: DashboardData; profile: Profile }) {
  const project = useMemo(() => pickProject(data.projects), [data.projects]);
  const currentPhase = normalizePhase(project?.phase || null);
  const currentIdx = phaseIndex(project?.phase || null);

  if (!project) {
    return (
      <main className="customer-portal">
        <div className="panel">
          <h3>No project found</h3>
          <p style={{ color: 'var(--ink-soft)', fontSize: 13.5 }}>
            There is no project linked to {profile.client_name || 'this account'} yet.
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
            A live status view of your project with M. Designs — where things stand and who to
            contact.
          </p>
        </div>
        <div className="customer-summary single">
          <div>
            <span className="k">Status</span>
            <span className="v">
              <StatusBadge status={project.status} />
            </span>
          </div>
          <div>
            <span className="k">Current phase</span>
            <span className="v" style={{ fontSize: 16 }}>
              {currentPhase || '—'}
            </span>
          </div>
        </div>
      </div>

      <div className="panel customer-detail customer-detail-solo">
        <h3>
          Your project <span className="tag">1 active engagement</span>
        </h3>
        <h2 className="display customer-detail-title">{project.project}</h2>

        <div className="customer-detail-grid">
          <div>
            <span className="k">Phase</span>
            <span className="v">{currentPhase || '—'}</span>
          </div>
          <div>
            <span className="k">Status</span>
            <span className="v">
              <StatusBadge status={project.status} />
            </span>
          </div>
          <div>
            <span className="k">Project manager</span>
            <span className="v">{project.manager || '—'}</span>
          </div>
          <div>
            <span className="k">Location</span>
            <span className="v">{project.city || '—'}</span>
          </div>
        </div>

        <div className="customer-phase-track">
          <div className="customer-progress-label">
            <span>Design & delivery progress</span>
            <span className="mono">
              {currentIdx >= 0 ? `Step ${currentIdx + 1} of ${PHASE_STEPS.length}` : 'In progress'}
            </span>
          </div>
          <ol className="phase-steps">
            {PHASE_STEPS.map((step, i) => {
              const state =
                currentIdx < 0 ? 'upcoming' : i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'upcoming';
              return (
                <li key={step} className={`phase-step ${state}`}>
                  <span className="phase-dot" aria-hidden="true" />
                  <span className="phase-label">{step}</span>
                </li>
              );
            })}
          </ol>
          <p className="customer-note">
            This tracker shows project status only. For schedule questions or deliverable reviews,
            reach out to your project manager{project.manager ? ` (${project.manager})` : ''}.
          </p>
        </div>
      </div>
    </main>
  );
}
