import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const tone = statusTone(row.budget_remaining);
  if (tone === 'active') return true;
  const firm = row.mdesigns_comments.trim();
  const client = row.client_comments.trim();
  if (firm && !client) return true;
  return false;
}

function hasConversation(row: ScheduleRow): boolean {
  return !!(row.mdesigns_comments.trim() || row.client_comments.trim() || needsAttention(row));
}

export function CustomerComms({
  projectKey,
  highlightPhase,
  managerName,
}: {
  projectKey: string;
  highlightPhase?: string | null;
  managerName?: string | null;
}) {
  const [schedule, setSchedule] = useState<ScheduleMeta | null>(null);
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('needs_you');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [phaseId, setPhaseId] = useState<string | null>(null);

  const sections = useMemo(() => groupScheduleSections(rows), [rows]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // RLS already scopes to this client — prefer exact project match, else first schedule.
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
      list.find((s) =>
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
  }, [projectKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!sections.length) {
      setPhaseId(null);
      return;
    }
    const preferred = defaultExpandedSectionIds(sections, highlightPhase)[0] || sections[0]!.id;
    setPhaseId((prev) => (prev && sections.some((s) => s.id === prev) ? prev : preferred));
  }, [sections, highlightPhase]);

  const activeSection = sections.find((s) => s.id === phaseId) || null;

  const visibleItems = useMemo(() => {
    if (filter === 'all') {
      return sections.flatMap((s) =>
        s.items.filter(hasConversation).map((row) => ({ row, sectionTitle: s.title })),
      );
    }
    if (filter === 'this_phase') {
      if (!activeSection) return [];
      return activeSection.items.map((row) => ({ row, sectionTitle: activeSection.title }));
    }
    // needs_you: prefer current phase actives / unanswered, then elsewhere
    const scored: { row: ScheduleRow; sectionTitle: string; rank: number }[] = [];
    for (const s of sections) {
      const inPhase = s.id === phaseId;
      for (const row of s.items) {
        if (!needsAttention(row) && !row.mdesigns_comments.trim()) continue;
        if (!needsAttention(row) && !hasConversation(row)) continue;
        if (!needsAttention(row)) continue;
        scored.push({
          row,
          sectionTitle: s.title,
          rank: (inPhase ? 0 : 10) + (statusTone(row.budget_remaining) === 'active' ? 0 : 1),
        });
      }
    }
    scored.sort((a, b) => a.rank - b.rank);
    if (scored.length) return scored.map(({ row, sectionTitle }) => ({ row, sectionTitle }));
    // Fallback: current phase items so the client always has somewhere to write
    if (activeSection) {
      return activeSection.items.slice(0, 8).map((row) => ({
        row,
        sectionTitle: activeSection.title,
      }));
    }
    return [];
  }, [filter, sections, activeSection, phaseId]);

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
    return <p className="cp-status">Loading messages…</p>;
  }
  if (error) {
    return <p className="cp-status err">{error}</p>;
  }
  if (!schedule) {
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
        <div className="cp-filter-tabs" role="tablist" aria-label="Message filters">
          {(
            [
              ['needs_you', 'Needs you'],
              ['this_phase', 'This phase'],
              ['all', 'All notes'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={filter === id ? 'active' : ''}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {sections.length > 1 ? (
          <label className="cp-phase-pick">
            <span>Phase</span>
            <select
              value={phaseId || ''}
              onChange={(e) => {
                setPhaseId(e.target.value);
                if (filter === 'needs_you') setFilter('this_phase');
              }}
            >
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
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
        Reply on any item below — {pm} sees your notes on the same schedule.
      </p>

      {!visibleItems.length ? (
        <div className="cp-empty-card">
          <p>Nothing needs your reply right now.</p>
          <button type="button" className="cp-text-btn" onClick={() => setFilter('this_phase')}>
            Browse this phase
          </button>
        </div>
      ) : (
        <ul className="cp-thread">
          {visibleItems.map(({ row, sectionTitle }) => {
            const firm = row.mdesigns_comments.trim();
            const urgent = needsAttention(row);
            return (
              <li key={row.id} className={`cp-msg-card${urgent ? ' urgent' : ''}`}>
                <div className="cp-msg-head">
                  <div>
                    <span className="cp-msg-phase mono">{sectionTitle}</span>
                    <h4 className="cp-msg-title">{row.task || 'Untitled'}</h4>
                  </div>
                  <StatusPill value={row.budget_remaining} />
                </div>

                {(row.target_start.trim() || row.target_end.trim()) && (
                  <p className="cp-msg-dates mono">
                    {row.target_start.trim() ? `Start ${row.target_start}` : ''}
                    {row.target_start.trim() && row.target_end.trim() ? ' · ' : ''}
                    {row.target_end.trim() ? `Target ${row.target_end}` : ''}
                  </p>
                )}

                {firm ? (
                  <div className="cp-bubble firm">
                    <span className="cp-bubble-label">From M. Designs</span>
                    <p>{firm}</p>
                  </div>
                ) : (
                  <div className="cp-bubble firm quiet">
                    <span className="cp-bubble-label">From M. Designs</span>
                    <p>No note on this item yet.</p>
                  </div>
                )}

                <label className="cp-bubble you">
                  <span className="cp-bubble-label">Your reply</span>
                  <textarea
                    rows={3}
                    value={row.client_comments}
                    placeholder={`Write a note for ${pm}…`}
                    onChange={(e) => onCommentChange(row.id, e.target.value)}
                    onBlur={(e) => void persistComment(row.id, e.target.value)}
                    aria-label={`Your reply on ${row.task || 'item'}`}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
