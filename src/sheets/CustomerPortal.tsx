import { useMemo } from 'react';
import type { DashboardData, ProjectRow } from '../lib/types';
import type { Profile } from '../lib/authTypes';
import { processPhaseLabel } from '../lib/architecturalProcess';
import { ProcessProgress } from '../components/ProcessProgress';
import { ProjectSchedule } from './ProjectSchedule';

function StatusBadge({ status }: { status: string | null }) {
  const s = (status || 'unknown').toLowerCase();
  return <span className={`badge ${s}`}>{status || '—'}</span>;
}

function pickProject(projects: ProjectRow[]) {
  if (!projects.length) return null;
  const active = projects.filter((p) => p.status === 'ACTIVE');
  const pool = active.length ? active : projects;
  return pool.slice().sort((a, b) => a.project.localeCompare(b.project))[0];
}

export function CustomerPortal({ data, profile }: { data: DashboardData; profile: Profile }) {
  const project = useMemo(() => pickProject(data.projects), [data.projects]);
  const currentPhase = processPhaseLabel(project?.phase || null);

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
            Follow where your project sits in M. Designs’ architectural process — what we’re doing
            now, and what we need from you.
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
              {currentPhase}
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
            <span className="v">{currentPhase}</span>
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

        <ProcessProgress projectPhase={project.phase} />

        <p className="customer-note">
          Open a process phase for architect/client subtasks, or expand a schedule section below to
          review tasks and leave comments for
          {project.manager ? ` ${project.manager}` : ' your project manager'}.
        </p>
      </div>

      <div className="panel customer-schedule">
        <h3>
          Project schedule <span className="tag">editable comments</span>
        </h3>
        <ProjectSchedule
          mode="customer"
          preferredProjectKey={project.project}
          highlightPhase={project.phase}
          embedded
        />
      </div>
    </main>
  );
}
