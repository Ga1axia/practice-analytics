import { fromDateInputValue, toDateInputValue } from '../lib/scheduleMutations';

/** Compact date control that stores firm M/D/YYYY text under the hood. */
export function ScheduleDateInput({
  value,
  disabled,
  ariaLabel,
  onCommit,
  autofilled,
}: {
  value: string;
  disabled?: boolean;
  ariaLabel: string;
  onCommit: (scheduleText: string) => void | Promise<void>;
  /** True when the date came from a schedule preset autofill. */
  autofilled?: boolean;
}) {
  return (
    <input
      type="date"
      className={`emp-date-input${autofilled ? ' autofilled' : ''}`}
      aria-label={autofilled ? `${ariaLabel} (autofilled)` : ariaLabel}
      title={autofilled ? 'Autofilled from schedule preset' : undefined}
      disabled={disabled}
      value={toDateInputValue(value)}
      onChange={(e) => {
        const next = e.target.value ? fromDateInputValue(e.target.value) : '';
        void onCommit(next);
      }}
    />
  );
}
