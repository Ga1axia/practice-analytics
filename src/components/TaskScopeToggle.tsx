import type { EmployeeTaskScope } from '../lib/employeeTaskScope';

export function TaskScopeToggle({
  scope,
  onChange,
  compact = false,
}: {
  scope: EmployeeTaskScope;
  onChange: (scope: EmployeeTaskScope) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`emp-status-toggle emp-task-scope-toggle${compact ? ' compact' : ''}`}
      role="group"
      aria-label="Which tasks to show"
    >
      <button
        type="button"
        className={scope === 'assigned' ? 'on' : ''}
        onClick={() => onChange('assigned')}
      >
        {compact ? 'Mine' : 'Assigned to me'}
      </button>
      <button
        type="button"
        className={scope === 'all' ? 'on' : ''}
        onClick={() => onChange('all')}
      >
        {compact ? 'All' : 'All project tasks'}
      </button>
    </div>
  );
}
