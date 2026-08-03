import { planSetsForProject } from '../lib/planSets';

export function PlanSetsPanel({
  projectKey,
  projectTitle,
  compact = false,
}: {
  projectKey: string;
  projectTitle: string;
  compact?: boolean;
}) {
  const sets = planSetsForProject(projectKey, projectTitle);

  return (
    <div className={`plan-sets${compact ? ' compact' : ''}`}>
      <div className="plan-sets-head">
        <h3>
          Plan sets <span className="tag">Box</span>
        </h3>
        <p className="pd-muted">
          Open drawing packages in Box. Staff-only — clients do not see these links in their portal.
        </p>
      </div>
      <ul className="plan-sets-list">
        {sets.map((s) => (
          <li key={s.id}>
            <div className="plan-sets-copy">
              <strong>{s.label}</strong>
              <span className="plan-sets-desc">{s.description}</span>
              <span className="mono plan-sets-meta">{s.updatedLabel}</span>
            </div>
            <a
              className="plan-sets-open"
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Box
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
