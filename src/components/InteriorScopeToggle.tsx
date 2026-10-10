import type { InteriorScope } from '../lib/employeePortalPrefs';

export function InteriorScopeToggle({
  scope,
  onChange,
  compact = false,
  labels,
  allowFirmWide = false,
}: {
  scope: InteriorScope;
  onChange: (scope: InteriorScope) => void;
  compact?: boolean;
  labels?: { interior: string; all: string; firm?: string };
  allowFirmWide?: boolean;
}) {
  const interiorLabel = labels?.interior ?? (compact ? 'Interior' : 'Interior only');
  const allLabel = labels?.all ?? (compact ? 'All' : 'All phases');
  const firmLabel = labels?.firm ?? (compact ? 'Firm ID' : 'Firm interior roster');
  return (
    <div
      className={`emp-status-toggle emp-interior-scope-toggle${compact ? ' compact' : ''}${allowFirmWide ? ' three-up' : ''}`}
      role="group"
      aria-label="Interior scope"
    >
      {allowFirmWide ? (
        <button
          type="button"
          className={scope === 'firm_interior' ? 'on' : ''}
          onClick={() => onChange('firm_interior')}
        >
          {firmLabel}
        </button>
      ) : null}
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
