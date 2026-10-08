import { useEffect, useState } from 'react';
import { ScheduleDateInput } from './ScheduleDateInput';
import type { EmployeeTask } from '../lib/employeeTasks';
import { loadProjectSchedule } from '../lib/loadProjectSchedule';
import {
  createScheduleTask,
  deleteScheduleRow,
  renameScheduleTask,
  setScheduleRowDates,
  updateScheduleRowFields,
} from '../lib/scheduleMutations';
import { isSubtaskComplete, subtasksForParent } from '../lib/taskSubtasks';
import {
  normalizeTaskUrl,
  parseTaskRowMeta,
  serializeTaskRowMeta,
  type TaskLink,
} from '../lib/taskRowMeta';
import type { ScheduleRow } from '../lib/scheduleTypes';
import { supabase } from '../lib/supabase';

type SubtaskDraft = {
  id: string;
  label: string;
  complete: boolean;
  isNew?: boolean;
};

export function TaskEditModal({
  task,
  open,
  onClose,
  onSaved,
}: {
  task: EmployeeTask | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [name, setName] = useState('');
  const [startRaw, setStartRaw] = useState('');
  const [dueRaw, setDueRaw] = useState('');
  const [notes, setNotes] = useState('');
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [subtasks, setSubtasks] = useState<SubtaskDraft[]>([]);
  const [newSubtask, setNewSubtask] = useState('');
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !task) return;
    let cancelled = false;
    setError(null);
    setLoading(true);
    void (async () => {
      const loaded = await loadProjectSchedule(task.projectKey);
      if (cancelled) return;
      const scheduleRows = loaded.rows;
      setRows(scheduleRows);
      const row = scheduleRows.find((r) => r.id === task.rowId);
      const meta = parseTaskRowMeta(row?.mdesigns_comments || '');
      setName(task.task);
      setStartRaw(task.startRaw || row?.target_start || '');
      setDueRaw(task.dueRaw || row?.target_end || '');
      setNotes(meta.notes);
      setLinks(meta.links);
      setLinkLabel('');
      setLinkUrl('');
      setNewSubtask('');
      if (task.kind === 'task') {
        setSubtasks(
          subtasksForParent(scheduleRows, task.rowId).map((st) => ({
            id: st.id,
            label: st.task,
            complete: isSubtaskComplete(st),
          })),
        );
      } else {
        setSubtasks([]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, task]);

  if (!open || !task) return null;

  async function toggleSubtask(st: SubtaskDraft) {
    if (!task?.writable || st.isNew) return;
    const next = !st.complete;
    const status = next ? 'Completed' : 'Incomplete';
    const endRaw = next
      ? new Date().toLocaleDateString('en-US', {
          month: 'numeric',
          day: 'numeric',
          year: '2-digit',
        })
      : '';
    const { error: upErr } = await supabase
      .from('pa_schedule_rows')
      .update({ budget_remaining: status, actual_end: endRaw })
      .eq('id', st.id);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setSubtasks((prev) =>
      prev.map((x) => (x.id === st.id ? { ...x, complete: next } : x)),
    );
  }

  async function removeSubtask(st: SubtaskDraft) {
    if (!task?.writable) return;
    if (st.isNew) {
      setSubtasks((prev) => prev.filter((x) => x.id !== st.id));
      return;
    }
    const res = await deleteScheduleRow({ projectKey: task.projectKey, rowId: st.id });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSubtasks((prev) => prev.filter((x) => x.id !== st.id));
    setRows((prev) => prev.filter((r) => r.id !== st.id));
  }

  function addLinkDraft() {
    const url = normalizeTaskUrl(linkUrl);
    if (!url) return;
    setLinks((prev) => [
      ...prev,
      { label: linkLabel.trim() || url, url },
    ]);
    setLinkLabel('');
    setLinkUrl('');
  }

  function addSubtaskDraft() {
    const label = newSubtask.trim();
    if (!label || task?.kind !== 'task') return;
    setSubtasks((prev) => [
      ...prev,
      { id: `new-${Date.now()}`, label, complete: false, isNew: true },
    ]);
    setNewSubtask('');
  }

  async function onSave() {
    if (!task?.writable) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError('Task name is required');
      setSaving(false);
      return;
    }

    if (trimmed !== task.task) {
      const res = await renameScheduleTask({
        projectKey: task.projectKey,
        rowId: task.rowId,
        task: trimmed,
      });
      if (!res.ok) {
        setError(res.error);
        setSaving(false);
        return;
      }
    }

    const dateRes = await setScheduleRowDates({
      projectKey: task.projectKey,
      rowId: task.rowId,
      targetStart: startRaw,
      targetEnd: dueRaw,
      rows,
    });
    if (!dateRes.ok) {
      setError(dateRes.error);
      setSaving(false);
      return;
    }

    const comments = serializeTaskRowMeta(notes, { links });
    const metaRes = await updateScheduleRowFields(task.projectKey, task.rowId, {
      mdesigns_comments: comments,
    });
    if (!metaRes.ok) {
      setError(metaRes.error);
      setSaving(false);
      return;
    }

    if (task.kind === 'task') {
      let afterId = task.rowId;
      for (const st of subtasks) {
        if (st.isNew) {
          const created = await createScheduleTask({
            projectKey: task.projectKey,
            scheduleId: task.scheduleId,
            phaseTitle: task.phase,
            task: st.label.trim(),
            kind: 'subtask',
            afterRowId: afterId,
            rows: dateRes.data.rows,
          });
          if (!created.ok) {
            setError(created.error);
            setSaving(false);
            return;
          }
          afterId = created.data.id;
        }
      }
    }

    setSaving(false);
    onSaved?.();
    onClose();
  }

  return (
    <div
      className="emp-task-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="emp-task-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="emp-task-modal panel">
        <header className="emp-task-modal-head">
          <div>
            <p className="pd-kicker">Edit task</p>
            <h2 id="emp-task-modal-title" className="display">
              {task.projectTitle}
            </h2>
            <p className="pd-muted mono">{task.phase}</p>
          </div>
          <button type="button" className="cp-text-btn" disabled={saving} onClick={onClose}>
            Close
          </button>
        </header>

        {error ? <p className="plist-upload-err">{error}</p> : null}
        {loading ? (
          <p className="pd-muted">Loading…</p>
        ) : (
          <>
            <label className="emp-task-modal-field">
              <span>Task name</span>
              <input
                type="text"
                value={name}
                disabled={!task.writable || saving}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <div className="emp-task-modal-dates">
              <label className="emp-task-modal-field">
                <span>Start</span>
                <ScheduleDateInput
                  value={startRaw}
                  disabled={!task.writable || saving}
                  ariaLabel="Start date"
                  onCommit={setStartRaw}
                />
              </label>
              <label className="emp-task-modal-field">
                <span>Due</span>
                <ScheduleDateInput
                  value={dueRaw}
                  disabled={!task.writable || saving}
                  ariaLabel="Due date"
                  onCommit={setDueRaw}
                />
              </label>
            </div>

            {task.kind === 'task' ? (
              <section className="emp-task-modal-section">
                <h3>Checklist</h3>
                <ul className="emp-task-checklist">
                  {subtasks.map((st) => (
                    <li key={st.id}>
                      <label className="emp-task-check-item">
                        <input
                          type="checkbox"
                          checked={st.complete}
                          disabled={!task.writable || saving || st.isNew}
                          onChange={() => void toggleSubtask(st)}
                        />
                        <span className={st.complete ? 'done' : ''}>{st.label}</span>
                      </label>
                      {task.writable ? (
                        <button
                          type="button"
                          className="emp-task-delete"
                          disabled={saving}
                          aria-label={`Remove ${st.label}`}
                          onClick={() => void removeSubtask(st)}
                        >
                          ×
                        </button>
                      ) : null}
                    </li>
                  ))}
                  {!subtasks.length ? (
                    <li className="pd-muted">No subtasks yet — add steps below.</li>
                  ) : null}
                </ul>
                {task.writable ? (
                  <div className="emp-task-modal-add-row">
                    <input
                      type="text"
                      placeholder="New subtask…"
                      value={newSubtask}
                      disabled={saving}
                      onChange={(e) => setNewSubtask(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addSubtaskDraft();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="emp-primary-btn"
                      disabled={saving || !newSubtask.trim()}
                      onClick={addSubtaskDraft}
                    >
                      Add
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="emp-task-modal-section">
              <h3>Links</h3>
              <ul className="emp-task-links">
                {links.map((l, i) => (
                  <li key={`${l.url}-${i}`}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer">
                      {l.label || l.url}
                    </a>
                    {task.writable ? (
                      <button
                        type="button"
                        className="emp-task-delete"
                        disabled={saving}
                        aria-label="Remove link"
                        onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
                      >
                        ×
                      </button>
                    ) : null}
                  </li>
                ))}
                {!links.length ? <li className="pd-muted">No links attached.</li> : null}
              </ul>
              {task.writable ? (
                <div className="emp-task-modal-links-add">
                  <input
                    type="text"
                    placeholder="Label (optional)"
                    value={linkLabel}
                    disabled={saving}
                    onChange={(e) => setLinkLabel(e.target.value)}
                  />
                  <input
                    type="url"
                    placeholder="https://…"
                    value={linkUrl}
                    disabled={saving}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addLinkDraft();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="emp-primary-btn"
                    disabled={saving || !linkUrl.trim()}
                    onClick={addLinkDraft}
                  >
                    Add link
                  </button>
                </div>
              ) : null}
            </section>

            <label className="emp-task-modal-field">
              <span>Notes</span>
              <textarea
                rows={3}
                value={notes}
                disabled={!task.writable || saving}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal notes (optional)"
              />
            </label>
          </>
        )}

        <footer className="emp-task-modal-foot">
          <button type="button" className="cp-text-btn" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          {task.writable ? (
            <button
              type="button"
              className="emp-primary-btn"
              disabled={saving || loading}
              onClick={() => void onSave()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
