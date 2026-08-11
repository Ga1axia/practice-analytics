import { useMemo, useState } from 'react';
import { parseScheduleDate } from '../lib/scheduleDates';
import { groupScheduleSections, statusTone } from '../lib/scheduleSections';
import type { ScheduleRow } from '../lib/scheduleTypes';
import { rowDateRange, rowStatusLabel } from '../lib/scheduleGantt';

type BoardColumnId = 'active' | 'upcoming' | 'idle' | 'done' | 'open';

type BoardCard = {
  id: string;
  label: string;
  kind: 'task' | 'subtask';
  section: string;
  status: string;
  tone: ReturnType<typeof statusTone>;
  dateLabel: string | null;
  column: BoardColumnId;
};

const COLUMNS: { id: BoardColumnId; label: string; hint: string }[] = [
  { id: 'active', label: 'Active', hint: 'In progress' },
  { id: 'upcoming', label: 'Upcoming', hint: 'Dated / TBD' },
  { id: 'idle', label: 'Not active', hint: 'Waiting' },
  { id: 'done', label: 'Done', hint: 'Completed / N/A' },
  { id: 'open', label: 'Open', hint: 'No status yet' },
];

function classifyRow(row: ScheduleRow): BoardColumnId {
  const status = rowStatusLabel(row);
  const tone = statusTone(status);
  if (tone === 'active') return 'active';
  if (tone === 'done' || tone === 'na') return 'done';
  if (tone === 'idle') return 'idle';
  if (tone === 'date') return 'upcoming';
  // Empty status but has a date → upcoming
  if (!status.trim() && rowDateRange(row)) return 'upcoming';
  return 'open';
}

function dateLabelFor(row: ScheduleRow): string | null {
  const range = rowDateRange(row);
  if (range) {
    const a = range.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (range.milestone) return a;
    const b = range.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${a} → ${b}`;
  }
  const raw = (row.target_start || row.budget_remaining || '').trim();
  if (raw && !parseScheduleDate(raw) && /tbd/i.test(raw)) return 'TBD';
  return null;
}

function buildCards(rows: ScheduleRow[]): BoardCard[] {
  const sections = groupScheduleSections(rows);
  const cards: BoardCard[] = [];
  for (const section of sections) {
    for (const row of section.items) {
      if (row.row_kind !== 'task' && row.row_kind !== 'subtask') continue;
      const status = rowStatusLabel(row);
      cards.push({
        id: row.id,
        label: row.task || '—',
        kind: row.row_kind,
        section: section.title,
        status,
        tone: statusTone(status),
        dateLabel: dateLabelFor(row),
        column: classifyRow(row),
      });
    }
  }
  return cards;
}

export function ScheduleBoard({ rows }: { rows: ScheduleRow[] }) {
  const [hideDone, setHideDone] = useState(false);
  const [kindFilter, setKindFilter] = useState<'all' | 'tasks' | 'subtasks'>('all');

  const cards = useMemo(() => buildCards(rows), [rows]);

  const filtered = useMemo(() => {
    return cards.filter((c) => {
      if (hideDone && c.column === 'done') return false;
      if (kindFilter === 'tasks' && c.kind !== 'task') return false;
      if (kindFilter === 'subtasks' && c.kind !== 'subtask') return false;
      return true;
    });
  }, [cards, hideDone, kindFilter]);

  const byCol = useMemo(() => {
    const map = Object.fromEntries(COLUMNS.map((c) => [c.id, [] as BoardCard[]])) as Record<
      BoardColumnId,
      BoardCard[]
    >;
    for (const card of filtered) map[card.column].push(card);
    return map;
  }, [filtered]);

  if (!cards.length) {
    return <div className="plist-empty">No tasks or subtasks to board yet.</div>;
  }

  return (
    <div className="sboard">
      <div className="sboard-toolbar">
        <div className="exec-toggle" role="group" aria-label="Board item filter">
          {(
            [
              ['all', 'All'],
              ['tasks', 'Tasks'],
              ['subtasks', 'Subtasks'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={kindFilter === id ? 'on' : ''}
              onClick={() => setKindFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="sboard-hide-done">
          <input
            type="checkbox"
            checked={hideDone}
            onChange={(e) => setHideDone(e.target.checked)}
          />
          Hide done
        </label>
      </div>

      <div className="sboard-cols">
        {COLUMNS.map((col) => {
          if (hideDone && col.id === 'done') return null;
          const items = byCol[col.id];
          return (
            <section key={col.id} className={`sboard-col col-${col.id}`}>
              <header className="sboard-col-head">
                <div>
                  <h4>{col.label}</h4>
                  <span className="sboard-col-hint mono">{col.hint}</span>
                </div>
                <span className="sboard-count mono">{items.length}</span>
              </header>
              <ul className="sboard-cards">
                {!items.length ? (
                  <li className="sboard-empty">—</li>
                ) : (
                  items.map((card) => (
                    <li key={card.id} className={`sboard-card kind-${card.kind}`}>
                      <div className="sboard-card-top">
                        <span className={`gantt-kind-tag ${card.kind}`}>
                          {card.kind === 'task' ? 'Tk' : 'Sub'}
                        </span>
                        <span className="sboard-sec mono">{card.section}</span>
                      </div>
                      <strong className="sboard-card-title">{card.label}</strong>
                      <div className="sboard-card-meta">
                        {card.status ? (
                          <span className={`sched-pill ${card.tone}`}>{card.status}</span>
                        ) : null}
                        {card.dateLabel ? (
                          <span className="sboard-date mono">{card.dateLabel}</span>
                        ) : null}
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
