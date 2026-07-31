import { useEffect, useState } from 'react';
import {
  PROCESS_PHASES,
  matchProcessPhaseIndex,
  type ProcessPhase,
  type ProcessPhaseId,
} from '../lib/architecturalProcess';

type PhaseState = 'done' | 'current' | 'upcoming';

function stateFor(i: number, currentIdx: number): PhaseState {
  if (currentIdx < 0) return 'upcoming';
  if (i < currentIdx) return 'done';
  if (i === currentIdx) return 'current';
  return 'upcoming';
}

function PhaseBody({ phase }: { phase: ProcessPhase }) {
  return (
    <div className="process-phase-body">
      <p className="process-summary">{phase.summary}</p>
      <div className="process-columns">
        <div className="process-col architect">
          <div className="process-col-label">
            <span className="process-role-icon" aria-hidden="true">
              ⌂
            </span>
            Architect · subsection tasks
          </div>
          <ol className="process-task-list">
            {phase.architect.map((item, i) => (
              <li key={item}>
                <span className="process-task-num">{i + 1}</span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="process-col client">
          <div className="process-col-label">
            <span className="process-role-icon" aria-hidden="true">
              ◆
            </span>
            Client · your subtasks
          </div>
          <ol className="process-task-list">
            {phase.client.map((item, i) => (
              <li key={item}>
                <span className="process-task-num client">{i + 1}</span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

export function ProcessProgress({ projectPhase }: { projectPhase: string | null }) {
  const currentIdx = matchProcessPhaseIndex(projectPhase);
  const [openId, setOpenId] = useState<ProcessPhaseId | null>(
    () => PROCESS_PHASES[currentIdx >= 0 ? currentIdx : 0]?.id ?? null,
  );

  useEffect(() => {
    if (currentIdx >= 0) setOpenId(PROCESS_PHASES[currentIdx].id);
  }, [currentIdx]);

  const progressPct =
    currentIdx < 0 ? 0 : Math.round(((currentIdx + 1) / PROCESS_PHASES.length) * 100);

  return (
    <div className="process-monitor">
      <div className="customer-progress-label">
        <span>Architectural process</span>
        <span className="mono">
          {currentIdx >= 0
            ? `Phase ${currentIdx + 1} of ${PROCESS_PHASES.length} · ${progressPct}%`
            : 'Phase not mapped yet'}
        </span>
      </div>

      <div className="process-progress-bar" aria-hidden="true">
        <div className="process-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="process-accordion" role="list">
        {PROCESS_PHASES.map((phase, i) => {
          const state = stateFor(i, currentIdx);
          const open = openId === phase.id;
          return (
            <div
              key={phase.id}
              role="listitem"
              className={`process-phase ${state}${open ? ' open' : ''}`}
              style={{ ['--phase' as string]: phase.color, ['--phase-soft' as string]: phase.colorSoft }}
            >
              <button
                type="button"
                className="process-phase-head"
                onClick={() => setOpenId(open ? null : phase.id)}
                aria-expanded={open}
              >
                <span className="process-phase-index mono">{String(i + 1).padStart(2, '0')}</span>
                <span className="process-phase-copy">
                  <span className="process-phase-name">{phase.name}</span>
                  <span className="process-phase-mile">Milestone · {phase.milestone}</span>
                </span>
                <span className={`process-phase-state ${state}`}>
                  {state === 'current' ? 'Current' : state === 'done' ? 'Done' : 'Upcoming'}
                </span>
                <span className="process-phase-chevron" aria-hidden="true">
                  {open ? '▾' : '▸'}
                </span>
              </button>
              {open ? <PhaseBody phase={phase} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
