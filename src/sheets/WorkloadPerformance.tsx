import { useMemo, useState } from 'react';
import {
  EfficiencyLineChart,
  HoursHBar,
  StackedHoursChart,
} from '../components/Charts';
import { KpiRow } from '../components/KpiRow';
import { QAPanel } from '../components/QAPanel';
import { fmtPct } from '../lib/format';
import type { CompanyMonthly, DashboardData, EmpMonthly } from '../lib/types';

type Bucket = {
  period: string;
  bill_hours: number;
  nb_hours: number;
  total_hours: number;
  standard_hours: number;
  efficiency: number;
};

const TRAILING: Record<string, number> = { month: 12, quarter: 8, year: 100 };

function toQuarter(m: string) {
  const [y, mo] = m.split('-').map(Number);
  return `${y}-Q${Math.ceil(mo / 3)}`;
}
function toYear(m: string) {
  return m.split('-')[0];
}
function periodLabel(p: string, gran: string) {
  if (gran === 'month') {
    const [y, mo] = p.split('-');
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-US', {
      month: 'short',
      year: 'numeric',
    });
  }
  return p;
}

function aggregateBuckets(monthlyRows: { month: string; bill_hours: number; nb_hours: number; total_hours: number; standard_hours: number }[], gran: string): Bucket[] {
  const map: Record<string, Omit<Bucket, 'period' | 'efficiency'>> = {};
  monthlyRows.forEach((r) => {
    const key = gran === 'month' ? r.month : gran === 'quarter' ? toQuarter(r.month) : toYear(r.month);
    if (!map[key]) map[key] = { bill_hours: 0, nb_hours: 0, total_hours: 0, standard_hours: 0 };
    map[key].bill_hours += r.bill_hours;
    map[key].nb_hours += r.nb_hours;
    map[key].total_hours += r.total_hours;
    map[key].standard_hours += r.standard_hours || 0;
  });
  return Object.keys(map)
    .sort()
    .map((k) => ({
      period: k,
      ...map[k],
      efficiency: map[k].standard_hours > 0 ? map[k].bill_hours / map[k].standard_hours : 0,
    }));
}

function teamMonthly(data: DashboardData, team: string): EmpMonthly[] {
  const roster = data.employee_roster[team] || [];
  const rows = data.emp_monthly.filter((m) => roster.includes(m.employee));
  const map: Record<string, EmpMonthly> = {};
  rows.forEach((r) => {
    if (!map[r.month]) {
      map[r.month] = {
        employee: team,
        month: r.month,
        bill_hours: 0,
        nb_hours: 0,
        total_hours: 0,
        standard_hours: 0,
        efficiency: 0,
        pto_hours: 0,
        network_days: 0,
      };
    }
    map[r.month].bill_hours += r.bill_hours;
    map[r.month].nb_hours += r.nb_hours;
    map[r.month].total_hours += r.total_hours;
    map[r.month].standard_hours += r.standard_hours || 0;
  });
  return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
}

export function WorkloadPerformance({ data }: { data: DashboardData }) {
  const [selectedEmp, setSelectedEmp] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<'month' | 'quarter' | 'year'>('month');
  const [periodValue, setPeriodValue] = useState('');
  const [empSearch, setEmpSearch] = useState('');

  const totalsByName = useMemo(() => {
    const m: Record<string, (typeof data.emp_totals)[0]> = {};
    data.emp_totals.forEach((e) => {
      m[e.employee] = e;
    });
    return m;
  }, [data.emp_totals]);

  function teamTotals(team: string) {
    const roster = data.employee_roster[team] || [];
    const rows = data.emp_totals.filter((e) => roster.includes(e.employee));
    const bill = rows.reduce((a, r) => a + r.bill_hours, 0);
    const std = rows.reduce((a, r) => a + (r.standard_hours || 0), 0);
    return { efficiency: std > 0 ? bill / std : 0 };
  }

  let monthlyRows: (EmpMonthly | CompanyMonthly)[];
  let topProj: { project: string; hours: number }[] = [];
  let title = 'Whole Firm';
  if (selectedEmp?.startsWith('TEAM:')) {
    const team = selectedEmp.slice(5);
    monthlyRows = teamMonthly(data, team);
    title = `${team} (aggregate)`;
  } else if (selectedEmp) {
    monthlyRows = data.emp_monthly
      .filter((m) => m.employee === selectedEmp)
      .sort((a, b) => a.month.localeCompare(b.month));
    topProj = data.emp_top_projects[selectedEmp] || [];
    title = selectedEmp;
  } else {
    monthlyRows = data.company_monthly.slice().sort((a, b) => a.month.localeCompare(b.month));
  }

  const buckets = aggregateBuckets(monthlyRows, granularity);

  let totals: Bucket;
  if (periodValue) {
    totals =
      buckets.find((b) => b.period === periodValue) || {
        period: periodValue,
        bill_hours: 0,
        nb_hours: 0,
        total_hours: 0,
        standard_hours: 0,
        efficiency: 0,
      };
  } else {
    const bill = buckets.reduce((a, b) => a + b.bill_hours, 0);
    const nb = buckets.reduce((a, b) => a + b.nb_hours, 0);
    const std = buckets.reduce((a, b) => a + b.standard_hours, 0);
    totals = {
      period: 'all',
      bill_hours: bill,
      nb_hours: nb,
      total_hours: bill + nb,
      standard_hours: std,
      efficiency: std > 0 ? bill / std : 0,
    };
  }

  let chartBuckets: Bucket[];
  let chartGran = granularity;
  if (periodValue) {
    if (granularity === 'month') {
      chartBuckets = buckets.filter((b) => b.period === periodValue);
    } else if (granularity === 'quarter') {
      chartBuckets = aggregateBuckets(monthlyRows, 'month').filter(
        (b) => toQuarter(b.period) === periodValue,
      );
      chartGran = 'month';
    } else {
      chartBuckets = aggregateBuckets(monthlyRows, 'quarter').filter(
        (b) => b.period.split('-')[0] === periodValue,
      );
      chartGran = 'quarter';
    }
  } else {
    chartBuckets = buckets.slice(-TRAILING[granularity]);
  }

  const granLabel =
    granularity === 'month' ? 'Monthly' : granularity === 'quarter' ? 'Quarterly' : 'Yearly';
  const periodTag = periodValue ? ` — ${periodLabel(periodValue, granularity)}` : ' — trailing';
  const isIndividual = !!selectedEmp && !selectedEmp.startsWith('TEAM:');

  const filterText = empSearch.toLowerCase();
  let empCount = 0;

  return (
    <section className="sheet active">
      <div className="filters">
        <span className="f-label">Filter</span>
        <select
          value={selectedEmp || ''}
          onChange={(e) => {
            setSelectedEmp(e.target.value || null);
            setPeriodValue('');
          }}
        >
          <option value="">Employee: Whole Firm</option>
          {Object.entries(data.employee_roster).map(([team, names]) => (
            <optgroup key={team} label={team}>
              <option value={'TEAM:' + team}>All {team} (aggregate)</option>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="f-label" style={{ marginLeft: 10 }}>
          View By
        </span>
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 2, overflow: 'hidden' }}>
          {(['month', 'quarter', 'year'] as const).map((g) => (
            <button
              key={g}
              type="button"
              className={`gran-btn ${granularity === g ? 'active' : ''}`}
              onClick={() => {
                setGranularity(g);
                setPeriodValue('');
              }}
            >
              {g[0].toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
        <select value={periodValue} onChange={(e) => setPeriodValue(e.target.value)}>
          <option value="">Period: All</option>
          {[...buckets].reverse().map((b) => (
            <option key={b.period} value={b.period}>
              {periodLabel(b.period, granularity)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="reset-btn"
          onClick={() => {
            setSelectedEmp(null);
            setGranularity('month');
            setPeriodValue('');
            setEmpSearch('');
          }}
        >
          RESET
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '300px 1fr' }}>
        <div className="panel" style={{ marginBottom: 0 }}>
          <h3>
            Employees <span className="tag">{/* count filled below */}</span>
          </h3>
          <input
            type="text"
            value={empSearch}
            onChange={(e) => setEmpSearch(e.target.value)}
            placeholder="Search employee…"
            style={{
              width: '100%',
              padding: '6px 10px',
              border: '1px solid var(--border)',
              margin: '8px 0',
              fontFamily: "'IBM Plex Sans',sans-serif",
              fontSize: 12.5,
            }}
          />
          <div className="emp-list">
            <div
              className={`emp-row ${!selectedEmp ? 'selected' : ''}`}
              onClick={() => {
                setSelectedEmp(null);
                setPeriodValue('');
              }}
            >
              <span className="name">— Whole Firm —</span>
              <span className="eff" />
            </div>
            {Object.entries(data.employee_roster).map(([team, names]) => {
              const visible = names.filter((n) => n.toLowerCase().includes(filterText));
              if (visible.length === 0 && !team.toLowerCase().includes(filterText)) return null;
              const namesToShow = visible.length > 0 ? visible : names;
              const tt = teamTotals(team);
              return (
                <div key={team}>
                  <div
                    className={`emp-row ${selectedEmp === 'TEAM:' + team ? 'selected' : ''}`}
                    style={{ background: 'var(--paper)', fontWeight: 600 }}
                    onClick={() => {
                      setSelectedEmp('TEAM:' + team);
                      setPeriodValue('');
                    }}
                  >
                    <span className="name">{team} — All (aggregate)</span>
                    <span className="eff">{fmtPct(tt.efficiency)}</span>
                  </div>
                  {namesToShow.map((n) => {
                    empCount++;
                    const t = totalsByName[n];
                    return (
                      <div
                        key={n}
                        className={`emp-row ${selectedEmp === n ? 'selected' : ''}`}
                        style={{ paddingLeft: 22 }}
                        onClick={() => {
                          setSelectedEmp(n);
                          setPeriodValue('');
                        }}
                      >
                        <span className="name">{n}</span>
                        <span className="eff">{t ? fmtPct(t.efficiency) : '—'}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 8 }}>{empCount} people</p>
        </div>

        <div>
          <KpiRow
            items={[
              {
                k: 'Billable Hours',
                v: Math.round(totals.bill_hours).toLocaleString(),
                cls: 'accent-teal',
              },
              {
                k: 'Non-Billable Hours',
                v: Math.round(totals.nb_hours).toLocaleString(),
                cls: 'accent-rust',
              },
              { k: 'Total Hours Worked', v: Math.round(totals.total_hours).toLocaleString() },
              {
                k: 'Standard Hours',
                v: Math.round(totals.standard_hours).toLocaleString(),
                sub: 'network days − PTO',
              },
              {
                k: 'Efficiency',
                v: fmtPct(totals.efficiency),
                cls: 'accent-gold',
                sub: 'billable ÷ standard',
              },
            ]}
          />

          <QAPanel
            sheet="s2"
            chips={[
              'Who has the highest efficiency?',
              'Who has logged the most billable hours?',
              'What is the US Team efficiency?',
              'How many billable hours has the Pak Team logged?',
            ]}
            examples={[
              "What is [employee name]'s efficiency?",
              'How many billable hours has [employee name] logged?',
              'What is the US Team efficiency?',
            ]}
            filters={{
              employee: selectedEmp || 'Whole Firm',
              granularity,
              period: periodValue || 'All',
            }}
          />

          <div className="grid grid-2">
            <div className="panel">
              <h3>
                {granLabel} Bill vs Non-Bill Hours ({title})
                {periodTag}
              </h3>
              <div className="chart-wrap">
                <StackedHoursChart
                  labels={chartBuckets.map((b) => periodLabel(b.period, chartGran))}
                  bill={chartBuckets.map((b) => b.bill_hours)}
                  nb={chartBuckets.map((b) => b.nb_hours)}
                />
              </div>
              <div className="legend-row">
                <span>
                  <span className="legend-dot" style={{ background: 'var(--teal)' }} />
                  Billable
                </span>
                <span>
                  <span className="legend-dot" style={{ background: 'var(--rust)' }} />
                  Non-Billable
                </span>
              </div>
            </div>
            <div className="panel">
              <h3>
                Efficiency Trend{' '}
                <span className="tag">{granLabel.toLowerCase()}, bill hrs / total hrs</span>
              </h3>
              <div className="chart-wrap">
                <EfficiencyLineChart
                  labels={chartBuckets.map((b) => periodLabel(b.period, chartGran))}
                  values={chartBuckets.map((b) => b.efficiency * 100)}
                />
              </div>
            </div>
          </div>
          <div className="panel">
            <h3>
              {isIndividual
                ? `Top Projects by Hours — ${title}`
                : 'Select an individual employee to see top projects'}
            </h3>
            <div className="chart-wrap">
              <HoursHBar
                labels={topProj.map((p) => p.project)}
                values={topProj.map((p) => p.hours)}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
