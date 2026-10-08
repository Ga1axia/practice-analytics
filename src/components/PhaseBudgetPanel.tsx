import { budgetBurnFillColor, type PhaseBudgetBar } from '../lib/phaseBudget';
import { fmtUSD, fmtUSDk } from '../lib/format';

type Props = {
  bars: PhaseBudgetBar[];
  /** When true, labels mark phases the viewer manages. */
  showOwnershipHint?: boolean;
};

export function PhaseBudgetPanel({ bars, showOwnershipHint = false }: Props) {
  if (!bars.length) return null;

  return (
    <section className="panel emp-phase-budget">
      <h3>
        Phase budget <span className="tag">spent / contract</span>
      </h3>
      <div className="mr-budget-list">
        {bars.map((p) => (
          <div key={p.key} className="mr-budget-row">
            <div className="mr-budget-label">
              <span title={p.completed ? 'Completed' : 'In progress'}>
                {p.label}
                {showOwnershipHint && p.isYours ? (
                  <span className="emp-phase-budget-yours"> · your phase</span>
                ) : null}
              </span>
              <span className="mono">
                {(p.pct * 100).toFixed(0)}% · {fmtUSDk(p.spent)} / {fmtUSDk(p.contract)}
                {p.spentHours > 0 ? ` · ${p.spentHours.toFixed(0)}h logged` : ''}
              </span>
            </div>
            <div className="mr-budget-track">
              <div
                className="mr-budget-fill"
                style={{
                  width: `${Math.min(Math.max(p.pct, 0) * 100, 100)}%`,
                  background: budgetBurnFillColor(p.pct, p.completed),
                }}
              />
            </div>
            {p.pct > 1 ? (
              <p className="emp-phase-budget-over mono">
                Over budget by {fmtUSD(Math.max(0, p.spent - p.contract))}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
