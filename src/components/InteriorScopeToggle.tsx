import type { InteriorScope } from '../lib/employeePortalPrefs';

export function InteriorScopeToggle({
  scope,
  onChange,
  compact = false,
  labels,
}: {
  scope: InteriorScope;
  onChange: (scope: InteriorScope) => void;
  compact?: boolean;
  labels?: { interior: string; all: string };
}) {
  const interiorLabel = labels?.interior ?? (compact ? 'Interior' : 'Interior only');
  const allLabel = labels?.all ?? (compact ? 'All' : 'All phases');
  return (
    <div
      className={`emp-status-toggle emp-interior-scope-toggle${compact ? ' compact' : ''}`}
      role="group"
      aria-label="Interior scope"
    >
      <button
        type="button"
        className={scope === 'interior' ? 'on' : ''}
        onClick={() => onChange('interior')}
      >
        {interiorLabel}
      </button>
      <button
        type="button"
        className={scope === 'all' ? 'on' : ''}
        onClick={() => onChange('all')}
      >
        {allLabel}
      </button>
    </div>
  );
}
