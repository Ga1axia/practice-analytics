import { useMemo, useState } from 'react';
import {
  getProjectStartDate,
  SCHEDULE_PRESET_KINDS,
  SCHEDULE_PRESET_LABELS,
  presetIncludesDates,
  type SchedulePresetKind,
} from '../lib/scheduleAutofill';
import { fromDateInputValue, toDateInputValue } from '../lib/scheduleMutations';

type Props = {
  projectKey: string;
  projectTitle: string;
  defaultPreset: SchedulePresetKind;
  busy?: boolean;
  error?: string | null;
  onYes: (input: { kickoff: Date; preset: SchedulePresetKind }) => void;
  onMaybeLater: () => void;
  onDontShowAgain: () => void;
};

function defaultKickoffInput(projectKey: string): string {
  const saved = getProjectStartDate(projectKey);
  const fromSaved = saved ? toDateInputValue(saved) : '';
  return fromSaved || toDateInputValue(new Date()) || '';
}

export function ScheduleStartPrompt({
  projectKey,
  projectTitle,
  defaultPreset,
  busy,
  error,
  onYes,
  onMaybeLater,
  onDontShowAgain,
}: Props) {
  const [preset, setPreset] = useState<SchedulePresetKind>(defaultPreset);
  const [kickoffText, setKickoffText] = useState(() => defaultKickoffInput(projectKey));
  const [localError, setLocalError] = useState<string | null>(null);

  const includesDates = useMemo(() => presetIncludesDates(preset), [preset]);
  const displayError = localError || error;

  return (
    <section className="panel emp-sched-start" aria-labelledby="emp-sched-start-title">
      <h3 id="emp-sched-start-title">No project schedule assigned</h3>
      <p className="pd-muted">
        <strong>{projectTitle}</strong> does not have a schedule yet. Do you want to start it from
        the firm checklist?
      </p>

      <div className="emp-sched-start-fields">
        <label>
          <span>Project start date</span>
          <input
            type="date"
            className="emp-date-input"
            disabled={busy}
            value={kickoffText}
            onChange={(e) => {
              setLocalError(null);
              setKickoffText(e.target.value);
            }}
            required
          />
        </label>
        <label>
          <span>Project kind</span>
          <select
            value={preset}
            disabled={busy}
            onChange={(e) => setPreset(e.target.value as SchedulePresetKind)}
          >
            {SCHEDULE_PRESET_KINDS.map((k) => (
              <option key={k} value={k}>
                {SCHEDULE_PRESET_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="emp-sched-start-note">
        {includesDates
          ? 'Yes autofills deadlines from the project start date. Autofilled dates are highlighted in teal.'
          : 'Interior checklists are created without deadlines — set start/due dates manually.'}
      </p>

      {displayError ? <p className="plist-upload-err">{displayError}</p> : null}

      <div className="emp-sched-start-actions">
        <button
          type="button"
          className="emp-primary-btn"
          disabled={busy}
          onClick={() => {
            setLocalError(null);
            const ymd = kickoffText || toDateInputValue(new Date());
            if (!ymd) {
              setLocalError('Pick a project start date first.');
              return;
            }
            const us = fromDateInputValue(ymd);
            if (!us) {
              setLocalError('Project start date is invalid.');
              return;
            }
            const [m, d, y] = us.split('/').map(Number);
            const kickoff = new Date(y!, m! - 1, d!);
            if (Number.isNaN(kickoff.getTime())) {
              setLocalError('Project start date is invalid.');
              return;
            }
            if (!kickoffText) setKickoffText(ymd);
            onYes({ kickoff, preset });
          }}
        >
          {busy ? 'Starting…' : 'Yes'}
        </button>
        <button
          type="button"
          className="emp-sched-start-secondary"
          disabled={busy}
          onClick={onMaybeLater}
        >
          Maybe later
        </button>
        <button
          type="button"
          className="emp-sched-start-secondary"
          disabled={busy}
          onClick={onDontShowAgain}
        >
          Don&apos;t show again
        </button>
      </div>
    </section>
  );
}
