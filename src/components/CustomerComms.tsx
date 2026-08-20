import { useCallback, useEffect, useMemo, useState } from 'react';
import { displayPhaseTitleClient, displayTaskTitle, glossaryTitle } from '../lib/clientCopy';
import { needsClientReply, portalSeenAt } from '../lib/clientPortal';
import {
  defaultExpandedSectionIds,
  groupScheduleSections,
  sectionStatus,
  statusTone,
} from '../lib/scheduleSections';
import type { ScheduleMeta, ScheduleRow } from '../lib/scheduleTypes';
import { supabase } from '../lib/supabase';

type Filter = 'needs_you' | 'this_phase' | 'all';

function StatusPill({ value }: { value: string }) {
  if (!value.trim()) return null;
  return <span className={`sched-pill ${statusTone(value)}`}>{value}</span>;
}

function needsAttention(row: ScheduleRow): boolean {
  return needsClientReply(row);
}

function hasNotes(row: ScheduleRow): boolean {
  return !!(row.mdesigns_comments.trim() || row.client_comments.trim());
}

function formatStamp(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function CustomerComms({
  projectKey,
  highlightPhase,
  managerName,
  rowsOverride = null,
  onNeedsCount,
}: {
  projectKey: string;
  highlightPhase?: string | null;
  managerName?: string | null;
  rowsOverride?: ScheduleRow[] | null;
  onNeedsCount?: (n: number) => void;
}) {
  const [schedule, setSchedule] = useState<ScheduleMeta | null>(null);
  const [rows, setRows] = useState<ScheduleRow[]>(rowsOverride || []);
  const [loading, setLoading] = useState(!rowsOverride);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('needs_you');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const sections = useMemo(() => groupScheduleSections(rows), [rows]);
  const seen = portalSeenAt(projectKey);

  const load = useCallback(async () => {
    if (rowsOverride) {
      setRows(rowsOverride);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const { data: scheds, error: sErr } = await supabase
      .from('pa_schedules')
      .select('id, project_key, client_name, title')
      .order('project_key');
    if (sErr) {
      setError(sErr.message);
      setLoading(false);
      return;
    }
    const list = (scheds || []) as ScheduleMeta[];
    const meta =
      list.find((s) => s.project_key === projectKey) ||
      list.find(
        (s) =>
          projectKey.toLowerCase().includes(s.project_key.toLowerCase()) ||
          s.project_key.toLowerCase().includes(projectKey.toLowerCase()),
      ) ||
      list[0] ||
      null;
    setSchedule(meta);
    if (!meta) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data: rowData, error: rErr } = await supabase
      .from('pa_schedule_rows')
      .select('*')
      .eq('schedule_id', meta.id)
      .order('sort_order');
    if (rErr) {
      setError(rErr.message);
      setLoading(false);
      return;
    }
    setRows((rowData || []) as ScheduleRow[]);
    setLoading(false);
  }, [projectKey, rowsOverride]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (rowsOverride) setRows(rowsOverride);
  }, [rowsOverride]);

  useEffect(() => {
    if (!sections.length) {
      setPhaseId(null);
      return;
    }
    const preferred = defaultExpandedSectionIds(sections, highlightPhase)[0] || sections[0]!.id;
    setPhaseId((prev) => (prev && sections.some((s) => s.id === prev) ? prev : preferred));
  }, [sections, highlightPhase]);

  const activeSection = sections.find((s) => s.id === phaseId) || null;

  const needsItems = useMemo(() => {
    const out: { row: ScheduleRow; sectionTitle: string }[] = [];
    for (const s of sections) {
      for (const row of s.items) {
        if (needsAttention(row)) out.push({ row, sectionTitle: s.title });
      }
    }
    return out;
  }, [sections]);

  useEffect(() => {
    onNeedsCount?.(needsItems.length);
  }, [needsItems.length, onNeedsCount]);

  const visibleItems = useMemo(() => {
    if (filter === 'all') {
      return sections.flatMap((s) =>
        s.items.filter((row) => hasNotes(row) || needsAttention(row)).map((row) => ({
          row,
          sectionTitle: s.title,
        })),
      );
    }
    if (filter === 'this_phase') {
      if (!activeSection) return [];
      return activeSection.items
        .filter((row) => hasNotes(row) || needsAttention(row))
        .map((row) => ({ row, sectionTitle: activeSection.title }));
    }
    return needsItems;
  }, [filter, sections, activeSection, needsItems]);

  async function persistComment(rowId: string, value: string) {
    setSavingId(rowId);
    setSaveNote(null);
    const { error: err } = await supabase
      .from('pa_schedule_rows')
      .update({ client_comments: value })
      .eq('id', rowId);
    setSavingId(null);
    if (err) {
      setSaveNote(err.message);
      return;
    }
    setSaveNote('Saved');
    window.setTimeout(() => setSaveNote((n) => (n === 'Saved' ? null : n)), 1400);
  }

  function onCommentChange(rowId: string, value: string) {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, client_comments: value } : r)));
  }

  if (loading) {
    return <p className="cp-status">Loading notes that need your input…</p>;
  }
  if (error) {
    return <p className="cp-status err">{error}</p>;
  }
  if (!rowsOverride && !schedule && !rows.length) {
    return (
      <p className="cp-status">
        Your project schedule isn’t linked yet. Your project manager can still email you — check
        back soon for in-portal notes.
      </p>
    );
  }

  const pm = managerName?.trim() || 'your project manager';

  return (
    <div className="cp-comms">
      <div className="cp-comms-toolbar">
        <div className="cp-filter-tabs" role="tablist" aria-label="Schedule note filters">
          {(
            [
              ['needs_you', `Needs you${needsItems.length ? ` (${needsItems.length})` : ''}`],
              ['this_phase', 'This phase'],
              ['all', 'All notes'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`cp-notes-tab-${id}`}
              aria-selected={filter === id}
              aria-controls="cp-notes-panel"
              className={filter === id ? 'active' : ''}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {sections.length > 1 ? (
          <label className="cp-phase-pick">
            <span id="cp-phase-label">Phase</span>
            <select
              value={phaseId || ''}
              aria-labelledby="cp-phase-label"
              onChange={(e) => {
                setPhaseId(e.target.value);
                if (filter === 'needs_you') setFilter('this_phase');
              }}
            >
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {displayPhaseTitleClient(s.title)}
                  {sectionStatus(s) ? ` · ${sectionStatus(s)}` : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="cp-save-note mono">
          {savingId ? 'Saving…' : saveNote || 'Comments save when you leave the field'}
        </span>
      </div>

      <p className="cp-comms-hint">
        {needsItems.length
          ? `${needsItems.length} item${needsItems.length === 1 ? '' : 's'} need your input. Click a row to reply.`
          : `Nothing waiting on you. ${pm} will see any reply you leave on a note.`}
      </p>

      <div id="cp-notes-panel" role="tabpanel" aria-labelledby={`cp-notes-tab-${filter}`}>
        {!visibleItems.length ? (
          <div className="cp-empty-card">
            <p>
              {filter === 'needs_you'
                ? 'Nothing needs your reply right now.'
                : 'No notes in this view yet.'}
            </p>
            {filter === 'needs_you' ? (
              <button type="button" className="cp-text-btn" onClick={() => setFilter('all')}>
                Browse all notes
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="cp-thread">
            {visibleItems.map(({ row, sectionTitle }) => {
              const firm = row.mdesigns_comments.trim();
              const urgent = needsAttention(row);
              const title = displayTaskTitle(row.task || 'Untitled');
              const stamp = formatStamp(row.updated_at);
              const unread =
                !!(firm && row.updated_at && (!seen || new Date(row.updated_at) > seen));
              const open = openId === row.id;
              return (
                <li key={row.id} className={`cp-msg-card${urgent ? ' urgent' : ''}${unread ? ' unread' : ''}`}>
                  <button
                    type="button"
                    className="cp-msg-toggle"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : row.id)}
                  >
                    <div className="cp-msg-head">
                      <div>
                        <span className="cp-msg-phase mono">
                          {displayPhaseTitleClient(sectionTitle)}
                        </span>
                        <h4 className="cp-msg-title" title={glossaryTitle(title)}>
                          {title}
                        </h4>
                      </div>
                      <div className="cp-msg-flags">
                        {unread ? <span className="cp-unread-dot" aria-label="Unread PM note" /> : null}
                        {urgent ? <span className="cp-need-badge">Needs you</span> : null}
                        <StatusPill value={row.budget_remaining} />
                      </div>
                    </div>
                    {(row.target_start.trim() || row.target_end.trim() || stamp) && (
                      <p className="cp-msg-dates mono">
                        {row.target_start.trim() ? `Start ${row.target_start}` : ''}
                        {row.target_start.trim() && row.target_end.trim() ? ' · ' : ''}
                        {row.target_end.trim() ? `Target ${row.target_end}` : ''}
                        {stamp ? ` · Updated ${stamp}` : ''}
                      </p>
                    )}
                  </button>

                  {open ? (
                    <div className="cp-msg-body">
                      {firm ? (
                        <div className="cp-bubble firm">
                          <span className="cp-bubble-label">
                            From M. Designs{unread ? ' · unread' : ''}
                          </span>
                          <p>{firm}</p>
                        </div>
                      ) : null}

                      <label className="cp-bubble you">
                        <span className="cp-bubble-label">Your reply</span>
                        <textarea
                          rows={3}
                          value={row.client_comments}
                          placeholder={`Write a note for ${pm}…`}
                          onChange={(e) => onCommentChange(row.id, e.target.value)}
                          onBlur={(e) => void persistComment(row.id, e.target.value)}
                          aria-label={`Your reply on ${title}`}
                        />
                      </label>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
