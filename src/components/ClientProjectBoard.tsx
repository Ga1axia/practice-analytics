import { useEffect, useState } from 'react';
import {
  PROCESS_PHASES,
  matchProcessPhaseIndex,
  processPhaseLabel,
  type ProcessPhaseId,
} from '../lib/architecturalProcess';
import type { ClientBoardMode, ClientBoardProject } from '../lib/clientBoardTypes';
import { ClientMeetingsPanel } from './ClientMeetingsPanel';
import { ClientMessageThread } from './ClientMessageThread';
import { CustomerComms } from './CustomerComms';
import { ScheduleDeadlineCalendar } from './ScheduleDeadlineCalendar';

function stageState(i: number, currentIdx: number): 'done' | 'current' | 'upcoming' {
  if (currentIdx < 0) return 'upcoming';
  if (i < currentIdx) return 'done';
  if (i === currentIdx) return 'current';
  return 'upcoming';
}

export function ClientProjectBoard({
  project,
  mode,
  authorName,
  banner,
}: {
  project: ClientBoardProject;
  mode: ClientBoardMode;
  authorName: string;
  banner?: string | null;
}) {
  const phaseIdx = matchProcessPhaseIndex(project.phase);
  const currentPhase = phaseIdx >= 0 ? PROCESS_PHASES[phaseIdx] : null;
  const phaseLabel = processPhaseLabel(project.phase);
  const [viewPhaseId, setViewPhaseId] = useState<ProcessPhaseId | null>(
    () => currentPhase?.id ?? PROCESS_PHASES[0]!.id,
  );

  useEffect(() => {
    if (currentPhase) setViewPhaseId(currentPhase.id);
  }, [currentPhase?.id]);

  const viewedIdx = PROCESS_PHASES.findIndex((p) => p.id === viewPhaseId);
  const viewedPhase =
    (viewedIdx >= 0 ? PROCESS_PHASES[viewedIdx] : null) || currentPhase || PROCESS_PHASES[0]!;
  const viewingCurrent = viewedPhase.id === currentPhase?.id;

  return (
    <div className={`cp-board mode-${mode}`}>
      {banner ? <div className="cp-pm-banner">{banner}</div> : null}

      <header className="cp-dash-top">
        <div className="cp-dash-title">
          <p className="customer-kicker">
            {mode === 'pm' ? 'Client portal preview' : 'Your project'}
          </p>
          <h1 className="display cp-project-title">{project.title}</h1>
          <p className="cp-meta-line">
            <span>{project.clientName}</span>
            <span className="dot">·</span>
            <span>{phaseLabel}</span>
            {project.status ? (
              <>
                <span className="dot">·</span>
                <span className={`badge ${(project.status || '').toLowerCase()}`}>
                  {project.status}
                </span>
              </>
            ) : null}
            {project.manager ? (
              <>
                <span className="dot">·</span>
                <span>PM {project.manager}</span>
              </>
            ) : null}
            {project.city ? (
              <>
                <span className="dot">·</span>
                <span>{project.city}</span>
              </>
            ) : null}
          </p>
        </div>
        {currentPhase ? (
          <div className="cp-milestone">
            <span className="k">Now</span>
            <span className="v">{currentPhase.name}</span>
            <span className="cp-milestone-sub mono">Milestone · {currentPhase.milestone}</span>
          </div>
        ) : null}
      </header>

      <div className="cp-dash-grid">
        <aside className="cp-stages" aria-label="Project stages">
          <div className="cp-stages-head">
            <p className="customer-kicker">Stages</p>
            <p className="cp-stages-lede">
              {phaseIdx >= 0
                ? `Stage ${phaseIdx + 1} of ${PROCESS_PHASES.length}`
                : 'Full process'}
            </p>
          </div>
          <ol className="cp-stage-rail">
            {PROCESS_PHASES.map((phase, i) => {
              const state = stageState(i, phaseIdx);
              const selected = viewedPhase.id === phase.id;
              return (
                <li key={phase.id}>
                  <button
                    type="button"
                    className={`cp-stage-btn ${state}${selected ? ' selected' : ''}`}
                    style={{ ['--phase' as string]: phase.color }}
                    onClick={() => setViewPhaseId(phase.id)}
                    aria-current={selected ? 'step' : undefined}
                  >
                    <span className="cp-stage-index mono">{String(i + 1).padStart(2, '0')}</span>
                    <span className="cp-stage-copy">
                      <span className="cp-stage-name">{phase.shortName}</span>
                      <span className="cp-stage-mile">{phase.milestone}</span>
                    </span>
                    <span className={`cp-stage-state ${state}`}>
                      {state === 'current' ? 'Now' : state === 'done' ? 'Done' : 'Next'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <div className="cp-dash-main">
          <section className="cp-card cp-needs" aria-labelledby="cp-needs-title">
            <div className="cp-needs-head">
              <div>
                <p className="customer-kicker">
                  {viewingCurrent ? 'Where we are' : 'Stage preview'}
                </p>
                <h2 id="cp-needs-title" className="display">
                  {viewedPhase.name}
                </h2>
                <p className="cp-phase-summary">{viewedPhase.summary}</p>
                {!viewingCurrent && currentPhase ? (
                  <button
                    type="button"
                    className="cp-text-btn cp-back-now"
                    onClick={() => setViewPhaseId(currentPhase.id)}
                  >
                    Back to current stage
                  </button>
                ) : null}
              </div>
              <div className="cp-milestone compact">
                <span className="k">Milestone</span>
                <span className="v">{viewedPhase.milestone}</span>
              </div>
            </div>

            <div className="cp-needs-grid">
              <div>
                <h3>What we need from you</h3>
                <ol className="cp-checklist">
                  {viewedPhase.client.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </div>
              <div>
                <h3>What we’re doing</h3>
                <ol className="cp-checklist soft">
                  {viewedPhase.architect.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </div>
            </div>
          </section>

          <section className="cp-card cp-talk" aria-labelledby="cp-direct-title">
            <div className="cp-talk-head">
              <p className="customer-kicker">Direct messages</p>
              <h2 id="cp-direct-title" className="display">
                {mode === 'pm' ? 'Message your client' : 'Talk with your team'}
              </h2>
              <p className="cp-phase-summary">
                {mode === 'pm'
                  ? 'Notes here appear in the client portal immediately.'
                  : `${project.manager || 'Your project manager'} can reply here and in schedule item notes.`}
              </p>
            </div>
            <ClientMessageThread project={project} mode={mode} authorName={authorName} />
          </section>

          {mode === 'customer' ? (
            <section className="cp-card cp-talk" aria-labelledby="cp-sched-title">
              <div className="cp-talk-head">
                <p className="customer-kicker">Schedule notes</p>
                <h2 id="cp-sched-title" className="display">
                  Item-level comments
                </h2>
                <p className="cp-phase-summary">
                  Replies tied to specific schedule tasks (shared with the project schedule).
                </p>
              </div>
              <CustomerComms
                projectKey={project.projectKey}
                highlightPhase={project.phase}
                managerName={project.manager}
              />
            </section>
          ) : (
            <>
              <section className="cp-card pd-meetings-panel">
                <ClientMeetingsPanel
                  projectKey={project.projectKey}
                  clientName={project.clientName}
                  compact
                />
              </section>
              <section className="cp-card">
                <p className="customer-kicker">Schedule notes</p>
                <p className="cp-phase-summary">
                  Edit firm notes and task status on the Project Schedule section of this dashboard
                  (below when you close preview). Direct messages above are what the client sees first.
                </p>
              </section>
            </>
          )}
        </div>
      </div>

      <ScheduleDeadlineCalendar projectKey={project.projectKey} corner />
    </div>
  );
}
