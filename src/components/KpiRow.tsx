type Kpi = { k: string; v: string; cls?: string; sub?: string; active?: boolean };

export function KpiRow({ items, className }: { items: Kpi[]; className?: string }) {
  return (
    <div className={['kpi-row', className].filter(Boolean).join(' ')}>
      {items.map((x) => (
        <div
          key={x.k}
          className={`kpi ${x.cls || ''}`}
          style={x.active ? { outline: '2px solid #101B2D', outlineOffset: -2 } : undefined}
        >
          <div className="k">{x.k}</div>
          <div className="v">{x.v}</div>
          {x.sub ? <div className="sub">{x.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}
