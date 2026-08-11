import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScheduleBoard } from '../components/ScheduleBoard';
import { ScheduleGantt } from '../components/ScheduleGantt';
import { ScheduleRoadmap } from '../components/ScheduleRoadmap';
import { supabase } from '../lib/supabase';
import {
  defaultExpandedSectionIds,
  groupScheduleSections,
  sectionProgress,
  sectionStatus,
  statusTone,
  type ScheduleSection,
} from '../lib/scheduleSections';
import type { ScheduleField, ScheduleMeta, ScheduleRow } from '../lib/scheduleTypes';

type StaffField = Exclude<ScheduleField, 'task' | 'client_comments'>;
type ScheduleView = 'list' | 'gantt' | 'roadmap' | 'board';

const STAFF_FIELDS: { key: StaffField; label: string }[] = [
  { key: 'budget_remaining', label: 'Status' },
  { key: 'target_start', label: 'Target start' },
  { key: 'target_end', label: 'Target end' },
  { key: 'actual_start', label: 'Actual start' },
  { key: 'actual_end', label: 'Actual end' },
  { key: 'action', label: 'Action' },
  { key: 'estimate_time', label: 'Estimate' },
  { key: 'mdesigns_comments', label: 'M. Designs notes' },
];

const CUSTOMER_META: { key: Exclude<ScheduleField, 'task' | 'client_comments'>; label: string }[] = [
  { key: 'budget_remaining', label: 'Status' },
  { key: 'target_start', label: 'Target start' },
  { key: 'target_end', label: 'Target end' },
  { key: 'mdesigns_comments', label: 'M. Designs notes' },
];

const VIEW_OPTIONS: { id: ScheduleView; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'gantt', label: 'Gantt' },
  { id: 'roadmap', label: 'Roadmap' },
  { id: 'board', label: 'Board' },
];

type Props = {
  mode: 'staff' | 'customer';
  preferredProjectKey?: string | null;
  highlightPhase?: string | null;
  embedded?: boolean;
  /** When true, hide the schedule's own project picker (parent dashboard owns selection). */
  lockProject?: boolean;
};

function StatusPill({ value }: { value: string }) {
  if (!value.trim()) return <span className="sched-pill muted">—</span>;
  const tone = statusTone(value);
  return <span className={`sched-pill ${tone}`}>{value}</span>;
}

function FieldInput({
  value,
  label,
  onChange,
  onPersist,
}: {
  value: string;
  label: string;
  onChange: (v: string) => void;
  onPersist: (v: string) => void;
}) {
  return (
    <label className="sched-field">
      <span>{label}</span>
      <textarea
        className="sched-cell"
        rows={value.length > 40 ? 2 : 1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onPersist(e.target.value)}
        aria-label={label}
      />
    </label>
  );
}

export function ProjectSchedule({
  mode,
  preferredProjectKey,
  highlightPhase,
  embedded,
  lockProject,
}: Props) {
  const isCustomer = mode === 'customer';
  const [schedules, setSchedules] = useState<ScheduleMeta[]>([]);
  const [scheduleId, setScheduleId] = useState('');
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [didInitExpand, setDidInitExpand] = useState(false);
  const [view, setView] = useState<ScheduleView>('list');

  const active = useMemo(
    () => schedules.find((s) => s.id === scheduleId) || null,
    [schedules, scheduleId],
  );

  const sections = useMemo(() => groupScheduleSections(rows), [rows]);

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('pa_schedules')
      .select('id, project_key, client_name, title')
      .order('project_key');
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const list = (data || []) as ScheduleMeta[];
    setSchedules(list);
    const needle = (preferredProjectKey || '').toLowerCase();
    const preferredMeta =
      (preferredProjectKey && list.find((s) => s.project_key === preferredProjectKey)) ||
      (needle
        ? list.find((s) => {
            const k = s.project_key.toLowerCase();
            return k.includes(needle) || needle.includes(k);
          })
        : null) ||
      null;
    const preferred = preferredMeta?.id || list[0]?.id || '';
    setScheduleId((prev) => {
      if (lockProject && preferred) return preferred;
      return prev && list.some((s) => s.id === prev) ? prev : preferred;
    });
    setLoading(false);
  }, [preferredProjectKey, lockProject]);

  const loadRows = useCallback(async (id: string) => {
    if (!id) {
      setRows([]);
      return;
    }
    const { data, error: err } = await supabase
      .from('pa_schedule_rows')
      .select('*')
      .eq('schedule_id', id)
      .order('sort_order');
    if (err) {
      setError(err.message);
      return;
    }
    setRows((data || []) as ScheduleRow[]);
    setDidInitExpand(false);
  }, []);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  useEffect(() => {
    void loadRows(scheduleId);
  }, [scheduleId, loadRows]);

  useEffect(() => {
    if (!sections.length || didInitExpand) return;
    setExpanded(new Set(defaultExpandedSectionIds(sections, highlightPhase)));
    setDidInitExpand(true);
  }, [sections, highlightPhase, didInitExpand]);

  function canEdit(field: ScheduleField) {
    if (field === 'task') return false;
    if (isCustomer) return field === 'client_comments';
    return true;
  }

  function onLocalChange(rowId: string, field: ScheduleField, value: string) {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)));
  }

  async function persist(rowId: string, field: ScheduleField, value: string) {
    if (!canEdit(field)) return;
    setSavingId(rowId);
    setSaveNote(null);
    const { error: err } = await supabase
      .from('pa_schedule_rows')
      .update({ [field]: value })
      .eq('id', rowId);
    setSavingId(null);
    if (err) {
      setSaveNote(err.message);
      return;
    }
    setSaveNote('Saved');
    window.setTimeout(() => setSaveNote((n) => (n === 'Saved' ? null : n)), 1200);
  }

  function toggleSection(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(sections.map((s) => s.id)));
  }

  function collapseAll() {
    setExpanded(new Set());
  }

  function renderItem(row: ScheduleRow) {
    const isSub = row.row_kind === 'subtask';
    return (
      <article key={row.id} className={`sched-item kind-${row.row_kind}`}>
        <div className="sched-item-main">
          <div className="sched-item-title-row">
            {isSub ? <span className="sched-sub-mark" aria-hidden="true" /> : null}
            <h4 className="sched-item-title">{row.task || '—'}</h4>
            <StatusPill value={row.budget_remaining} />
          </div>

          {isCustomer ? (
            <div className="sched-item-meta">
              {CUSTOMER_META.filter((f) => f.key !== 'budget_remaining').map((f) => {
                const val = row[f.key];
                if (!val.trim() && f.key !== 'mdesigns_comments') return null;
                return (
                  <div key={f.key} className="sched-meta-block">
                    <span className="sched-meta-k">{f.label}</span>
                    <span className="sched-meta-v">{val.trim() || '—'}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="sched-staff-grid">
              {STAFF_FIELDS.map((f) => (
                <FieldInput
                  key={f.key}
                  label={f.label}
                  value={row[f.key]}
                  onChange={(v) => onLocalChange(row.id, f.key, v)}
                  onPersist={(v) => void persist(row.id, f.key, v)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="sched-item-comments">
          <label className="sched-field">
            <span>Client’s comments</span>
            {canEdit('client_comments') ? (
              <textarea
                className="sched-cell comment"
                rows={2}
                value={row.client_comments}
                onChange={(e) => onLocalChange(row.id, 'client_comments', e.target.value)}
                onBlur={(e) => void persist(row.id, 'client_comments', e.target.value)}
                placeholder={isCustomer ? 'Add a note for your project manager…' : ''}
                aria-label={`Client comments for ${row.task}`}
              />
            ) : (
              <span className="sched-meta-v">{row.client_comments.trim() || '—'}</span>
            )}
          </label>
          {!isCustomer && row.mdesigns_comments.trim() === '' ? null : null}
        </div>
      </article>
    );
  }

  function renderSection(section: ScheduleSection) {
    const open = expanded.has(section.id);
    const status = sectionStatus(section);
    const { done, total } = sectionProgress(section);
    const phaseNote = section.phaseRow?.target_start?.trim() || '';

    return (
      <section key={section.id} className={`sched-section${open ? ' open' : ''}`}>
        <button
          type="button"
          className="sched-section-head"
          onClick={() => toggleSection(section.id)}
          aria-expanded={open}
        >
          <span className="sched-chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className="sched-section-copy">
            <span className="sched-section-title">{section.title}</span>
            {phaseNote ? <span className="sched-section-note">{phaseNote}</span> : null}
          </span>
          <span className="sched-section-stats">
            {status ? <StatusPill value={status} /> : null}
            <span className="sched-count mono">
              {done}/{total || section.items.length} done
            </span>
            <span className="sched-count soft mono">{section.items.length} items</span>
          </span>
        </button>

        {open ? (
          <div className="sched-section-body">
            {!section.items.length ? (
              <p className="sched-empty">No tasks in this section yet.</p>
            ) : (
              section.items.map((row) => renderItem(row))
            )}
          </div>
        ) : null}
      </section>
    );
  }

  const viewHint =
    view === 'list'
      ? isCustomer
        ? 'Sections stay collapsed until opened. Task names are fixed — add notes in Client’s comments.'
        : 'Task names are fixed. Open a section to edit status, dates, and notes.'
      : view === 'gantt'
        ? 'Timeline of dated tasks, subtasks, and phase rollups.'
        : view === 'roadmap'
          ? 'Phase structure with nested tasks and progress.'
          : 'Status columns across tasks and subtasks. Switch to List to edit.';

  const body = (
    <>
      <div className="filters schedule-toolbar">
        {!lockProject ? <span className="f-label">Project schedule</span> : null}
        {!lockProject && schedules.length > 1 ? (
          <select value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {s.project_key}
              </option>
            ))}
          </select>
        ) : !lockProject && active ? (
          <span className="schedule-project">{active.project_key}</span>
        ) : null}
        {active ? (
          <span className="schedule-meta">
            {lockProject ? active.project_key : active.client_name || '—'}
            {savingId ? ' · Saving…' : saveNote ? ` · ${saveNote}` : ''}
          </span>
        ) : null}

        <div className="exec-toggle schedule-view-toggle" role="group" aria-label="Schedule view">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={view === opt.id ? 'on' : ''}
              onClick={() => setView(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {view === 'list' ? (
          <div className="schedule-actions">
            <button type="button" className="sched-text-btn" onClick={expandAll}>
              Expand all
            </button>
            <button type="button" className="sched-text-btn" onClick={collapseAll}>
              Collapse all
            </button>
          </div>
        ) : null}
        <span className="schedule-hint">{viewHint}</span>
      </div>

      {loading ? <p className="schedule-status">Loading schedule…</p> : null}
      {error ? <p className="schedule-status err">{error}</p> : null}
      {!loading && !error && !schedules.length ? (
        <p className="schedule-status">No project schedule is available for your account yet.</p>
      ) : null}

      {!loading && !error && rows.length ? (
        <div className="schedule-view-body">
          {view === 'list' ? (
            <div className="sched-accordion">{sections.map(renderSection)}</div>
          ) : null}
          {view === 'gantt' && active ? (
            <ScheduleGantt
              projectKey={active.project_key}
              highlightPhase={highlightPhase}
              rowsOverride={rows}
            />
          ) : null}
          {view === 'roadmap' ? (
            <ScheduleRoadmap rows={rows} highlightPhase={highlightPhase} />
          ) : null}
          {view === 'board' ? <ScheduleBoard rows={rows} /> : null}
        </div>
      ) : null}

      {!loading && !error && schedules.length && !rows.length ? (
        <p className="schedule-status">This schedule has no rows yet.</p>
      ) : null}
    </>
  );

  if (embedded) {
    return <div className="schedule-embed">{body}</div>;
  }

  return <section className="sheet active">{body}</section>;
}
