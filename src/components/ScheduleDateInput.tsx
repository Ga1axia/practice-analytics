import { fromDateInputValue, toDateInputValue } from '../lib/scheduleMutations';

/** Compact date control that stores firm M/D/YYYY text under the hood. */
export function ScheduleDateInput({
  value,
  disabled,
  ariaLabel,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  ariaLabel: string;
  onCommit: (scheduleText: string) => void | Promise<void>;
}) {
  return (
    <input
      type="date"
      className="emp-date-input"
      aria-label={ariaLabel}
      disabled={disabled}
      value={toDateInputValue(value)}
      onChange={(e) => {
        const next = e.target.value ? fromDateInputValue(e.target.value) : '';
        void onCommit(next);
      }}
    />
  );
}
