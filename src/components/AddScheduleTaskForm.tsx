import { useMemo, useState, type FormEvent } from 'react';
import { createScheduleTask, fromDateInputValue } from '../lib/scheduleMutations';
import type { ScheduleRow } from '../lib/scheduleTypes';

export function AddScheduleTaskForm({
  projectKey,
  scheduleId,
  phaseOptions,
  rows,
  defaultPhase,
  defaultDueYmd,
  assigneeOptions,
  defaultAssignee,
  onCreated,
  onCancel,
}: {
  projectKey: string;
  scheduleId: string;
  phaseOptions: string[];
  rows?: ScheduleRow[];
  defaultPhase?: string;
  /** YYYY-MM-DD seed for due date (e.g. selected calendar day). */
  defaultDueYmd?: string;
  assigneeOptions?: string[];
  defaultAssignee?: string;
  onCreated: (row: ScheduleRow) => void;
  onCancel?: () => void;
}) {
  const phases = useMemo(
    () => (phaseOptions.length ? phaseOptions : ['Project kickoff']),
    [phaseOptions],
  );
  const [task, setTask] = useState('');
  const [phase, setPhase] = useState(defaultPhase || phases[0] || 'Project kickoff');
  const [kind, setKind] = useState<'task' | 'subtask'>('task');
  const [dueYmd, setDueYmd] = useState(defaultDueYmd || '');
  const [startYmd, setStartYmd] = useState('');
  const [assignee, setAssignee] = useState(defaultAssignee || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await createScheduleTask({
      projectKey,
      scheduleId,
      phaseTitle: phase,
      task,
      kind,
      targetStart: startYmd ? fromDateInputValue(startYmd) : '',
      targetEnd: dueYmd ? fromDateInputValue(dueYmd) : '',
      assigneeName: assignee,
      rows,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onCreated(res.data);
    setTask('');
  }

  return (
    <form className="emp-add-task" onSubmit={(e) => void submit(e)}>
      <div className="emp-add-task-grid">
        <label>
          <span>Task</span>
          <input
            type="text"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="What needs to get done?"
            required
            autoFocus
          />
        </label>
        <label>
          <span>Phase</span>
          <select value={phase} onChange={(e) => setPhase(e.target.value)}>
            {phases.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'task' | 'subtask')}>
            <option value="task">Task</option>
            <option value="subtask">Subtask</option>
          </select>
        </label>
        {assigneeOptions?.length ? (
          <label>
            <span>Assignee</span>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Unassigned</option>
              {assigneeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          <span>Start</span>
          <input
            type="date"
            value={startYmd}
            onChange={(e) => setStartYmd(e.target.value)}
            aria-label="Start date"
          />
        </label>
        <label>
          <span>Due</span>
          <input
            type="date"
            value={dueYmd}
            onChange={(e) => setDueYmd(e.target.value)}
            aria-label="Due date"
          />
        </label>
      </div>
      {error ? <p className="plist-upload-err">{error}</p> : null}
      <div className="emp-add-task-actions">
        <button type="submit" className="emp-primary-btn" disabled={busy || !task.trim()}>
          {busy ? 'Saving…' : 'Add task'}
        </button>
        {onCancel ? (
          <button type="button" className="cp-text-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
