import { useMemo, useState } from 'react';
import {
  groupScheduleSections,
  nestSectionItems,
  sectionProgress,
  sectionStatus,
  statusTone,
  type ScheduleSection,
} from '../lib/scheduleSections';
import type { ScheduleRow } from '../lib/scheduleTypes';
import { rowStatusLabel } from '../lib/scheduleGantt';

function StatusPill({ value }: { value: string }) {
  if (!value.trim()) return null;
  const tone = statusTone(value);
  return <span className={`sched-pill ${tone}`}>{value}</span>;
}

function PhaseCard({
  section,
  index,
  total,
  highlighted,
  defaultOpen,
}: {
  section: ScheduleSection;
  index: number;
  total: number;
  highlighted: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || highlighted);
  const status = sectionStatus(section);
  const { done, total: countable } = sectionProgress(section);
  const pct = countable ? Math.round((done / countable) * 100) : 0;
  const tone = statusTone(status);
  const trees = nestSectionItems(section.items);
  const phaseNote =
    section.phaseRow?.target_start?.trim() ||
    section.phaseRow?.mdesigns_comments?.trim() ||
    '';

  return (
    <article
      className={`srm-phase tone-${tone || 'muted'}${highlighted ? ' highlight' : ''}${open ? ' open' : ''}`}
    >
      <div className="srm-rail" aria-hidden="true">
        <span className="srm-node mono">{String(index + 1).padStart(2, '0')}</span>
        {index < total - 1 ? <span className="srm-line" /> : null}
      </div>

      <div className="srm-card">
        <button
          type="button"
          className="srm-head"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <div className="srm-head-copy">
            <div className="srm-title-row">
              <h4 className="srm-title">{section.title}</h4>
              {status ? <StatusPill value={status} /> : null}
            </div>
            {phaseNote ? <p className="srm-note">{phaseNote}</p> : null}
            <div className="srm-progress">
              <div className="srm-progress-track" aria-hidden="true">
                <div className="srm-progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="mono srm-progress-label">
                {done}/{countable || section.items.length} · {pct}%
              </span>
            </div>
          </div>
          <span className="srm-chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
        </button>

        {open ? (
          <div className="srm-body">
            {!trees.length ? (
              <p className="srm-empty">No tasks in this phase yet.</p>
            ) : (
              <ul className="srm-tree">
                {trees.map((node) => {
                  const taskStatus = rowStatusLabel(node.task);
                  return (
                    <li key={node.task.id} className="srm-task">
                      <div className="srm-task-row">
                        <span className="srm-kind mono">Tk</span>
                        <span className="srm-task-name">{node.task.task || '—'}</span>
                        {taskStatus ? <StatusPill value={taskStatus} /> : null}
                      </div>
                      {node.subtasks.length ? (
                        <ul className="srm-subs">
                          {node.subtasks.map((sub) => {
                            const subStatus = rowStatusLabel(sub);
                            return (
                              <li key={sub.id} className="srm-sub">
                                <span className="srm-kind mono">Sub</span>
                                <span className="srm-task-name">{sub.task || '—'}</span>
                                {subStatus ? <StatusPill value={subStatus} /> : null}
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function ScheduleRoadmap({
  rows,
  highlightPhase,
}: {
  rows: ScheduleRow[];
  highlightPhase?: string | null;
}) {
  const sections = useMemo(() => groupScheduleSections(rows), [rows]);

  const highlightId = useMemo(() => {
    const needle = (highlightPhase || '').trim().toLowerCase();
    if (!needle) return null;
    const hit = sections.find((s) => {
      const title = s.title.toLowerCase();
      return (
        title.includes(needle) ||
        needle.includes(title) ||
        title.includes(needle.split(' ')[0] || '')
      );
    });
    return hit?.id ?? null;
  }, [sections, highlightPhase]);

  const activeId = useMemo(() => {
    if (highlightId) return highlightId;
    const active = sections.find((s) => {
      const st = sectionStatus(s);
      return /active/i.test(st) && !/not\s*active/i.test(st);
    });
    return active?.id ?? null;
  }, [sections, highlightId]);

  if (!sections.length) {
    return <div className="plist-empty">No schedule structure to show yet.</div>;
  }

  return (
    <div className="srm">
      <div className="srm-summary mono">
        <span>{sections.length} phases</span>
        <span aria-hidden="true">·</span>
        <span>{rows.filter((r) => r.row_kind === 'task').length} tasks</span>
        <span aria-hidden="true">·</span>
        <span>{rows.filter((r) => r.row_kind === 'subtask').length} subtasks</span>
      </div>
      <div className="srm-list">
        {sections.map((section, i) => (
          <PhaseCard
            key={section.id}
            section={section}
            index={i}
            total={sections.length}
            highlighted={section.id === activeId}
            defaultOpen={section.id === activeId}
          />
        ))}
      </div>
    </div>
  );
}
