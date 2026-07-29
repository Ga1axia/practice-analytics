import { useMemo, useState } from 'react';
import { DoughnutChart, HBarChart } from '../components/Charts';
import { KpiRow } from '../components/KpiRow';
import { QAPanel } from '../components/QAPanel';
import { fmtPct, fmtUSD, monthLabel, palette } from '../lib/format';
import type { DashboardData, ProjectRow } from '../lib/types';

const PAGE_SIZE = 25;

function sum(rows: ProjectRow[], key: keyof ProjectRow) {
  return rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
}

function groupSum(
  rows: ProjectRow[],
  keyFn: (r: ProjectRow) => string | null | undefined,
  valFn: (r: ProjectRow) => number,
) {
  const map: Record<string, number> = {};
  rows.forEach((r) => {
    const k = keyFn(r);
    if (!k) return;
    map[k] = (map[k] || 0) + valFn(r);
  });
  return map;
}

function topEntries(map: Record<string, number>, n: number) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

export function ProjectAnalysis({ data }: { data: DashboardData }) {
  const [status, setStatus] = useState('');
  const [manager, setManager] = useState('');
  const [type, setType] = useState('');
  const [month, setMonth] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: number }>({ key: 'contract', dir: -1 });
  const [page, setPage] = useState(0);

  const getBilled = (row: ProjectRow, m = month) => {
    if (!m) return row.billed;
    const map = data.project_monthly_billed[row.project];
    return (map && map[m]) || 0;
  };

  const filtered = useMemo(() => {
    const teamRoster = manager.startsWith('TEAM:')
      ? data.employee_roster[manager.slice(5)] || []
      : null;
    const q = search.trim().toLowerCase();
    return data.projects.filter((p) => {
      if (status && p.status !== status) return false;
      if (manager) {
        if (teamRoster) {
          if (!teamRoster.includes(p.manager || '')) return false;
        } else if (p.manager !== manager) return false;
      }
      if (type && p.type !== type) return false;
      if (
        q &&
        !(p.project.toLowerCase().includes(q) || (p.client || '').toLowerCase().includes(q))
      )
        return false;
      return true;
    });
  }, [data, status, manager, type, search]);

  const sorted = useMemo(() => {
    return filtered.slice().sort((a, b) => {
      const k = sort.key;
      const av = k === 'billed' ? getBilled(a) : (a as Record<string, unknown>)[k];
      const bv = k === 'billed' ? getBilled(b) : (b as Record<string, unknown>)[k];
      if (typeof av === 'string' && typeof bv === 'string') return sort.dir * av.localeCompare(bv);
      return sort.dir * ((Number(av) || 0) - (Number(bv) || 0));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, month]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages - 1);
  const pageRows = sorted.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE);

  const billedTotal = filtered.reduce((a, r) => a + getBilled(r), 0);
  const contract = sum(filtered, 'contract');
  const remaining = Math.max(contract - billedTotal, 0);
  const profit = sum(filtered, 'profit');
  const profitPos = Math.max(profit, 0);
  const costBasis = Math.max(sum(filtered, 'billed') - profitPos, 0);

  const clientTop = topEntries(
    groupSum(filtered, (r) => r.client, (r) => getBilled(r)),
    10,
  );
  const phaseTop = topEntries(
    groupSum(
      filtered.filter((r) => r.phase !== 'Internal/PTO' && r.phase !== 'Other'),
      (r) => r.phase,
      (r) => r.contract,
    ),
    10,
  );
  const mgrTop = topEntries(groupSum(filtered, (r) => r.manager, (r) => r.contract), 10);

  function toggleSort(key: string) {
    setSort((s) => (s.key === key ? { key, dir: s.dir * -1 } : { key, dir: -1 }));
  }

  return (
    <section className="sheet active">
      <div className="filters">
        <span className="f-label">Filter</span>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Status: All</option>
          {data.statuses
            .filter((s) => s !== 'UNKNOWN')
            .map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
        </select>
        <select
          value={manager}
          onChange={(e) => {
            setManager(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Employee: All</option>
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
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Contract Type: All</option>
          {data.contract_types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Period: All</option>
          {[...data.billing_months].reverse().map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Search project or client…"
        />
        <button
          type="button"
          className="reset-btn"
          onClick={() => {
            setStatus('');
            setManager('');
            setType('');
            setMonth('');
            setSearch('');
            setPage(0);
          }}
        >
          RESET
        </button>
      </div>

      <KpiRow
        items={[
          { k: 'Contract Amount', v: fmtUSD(contract) },
          { k: 'Amount Spent', v: fmtUSD(sum(filtered, 'spent')), cls: 'accent-teal' },
          {
            k: month ? `Billed — ${monthLabel(month)}` : 'Amount Billed (All-Time)',
            v: fmtUSD(billedTotal),
            cls: 'accent-gold',
          },
          { k: 'Amount Receivable', v: fmtUSD(sum(filtered, 'ar')), cls: 'accent-rust' },
          { k: 'Retainer Balance', v: fmtUSD(sum(filtered, 'retainer_balance')) },
          { k: 'Net Profit', v: fmtUSD(profit), cls: 'accent-green' },
        ]}
      />

      <QAPanel
        sheet="s1"
        chips={[
          'Which client has the highest billed amount?',
          'Which project manager has the highest contract value?',
          'How many active projects are there?',
          'What is the total profit margin?',
        ]}
        examples={[
          'How much has been billed to [client name]?',
          'What is the contract amount for [project name]?',
          'How many completed projects are there?',
        ]}
        filters={{
          status: status || 'All',
          employee_filter: manager || 'All',
          contract_type: type || 'All',
          period_month: month || 'All (all-time)',
        }}
      />

      <div className="grid grid-2">
        <div className="panel">
          <h3>
            Project Details{' '}
            <span className="tag">{sorted.length.toLocaleString()} rows</span>
          </h3>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  {(
                    [
                      ['project', 'Project'],
                      ['client', 'Client'],
                      ['manager', 'Employee'],
                      ['status', 'Status'],
                      ['type', 'Type'],
                      ['contract', 'Contract'],
                      ['spent', 'Spent'],
                      ['billed', 'Billed'],
                      ['ar', 'Receivable'],
                      ['margin', 'Margin'],
                    ] as const
                  ).map(([key, label]) => (
                    <th
                      key={key}
                      className={
                        ['contract', 'spent', 'billed', 'ar', 'margin'].includes(key) ? 'num' : ''
                      }
                      onClick={() => toggleSort(key)}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.project}>
                    <td>{r.project}</td>
                    <td>{r.client || ''}</td>
                    <td>{r.manager}</td>
                    <td>
                      <span className={`badge ${(r.status || '').toLowerCase()}`}>{r.status}</span>
                    </td>
                    <td>{r.type}</td>
                    <td className="num">{fmtUSD(r.contract)}</td>
                    <td className="num">{fmtUSD(r.spent)}</td>
                    <td className="num">{fmtUSD(getBilled(r))}</td>
                    <td className="num">{fmtUSD(r.ar)}</td>
                    <td className="num">
                      {r.margin != null && isFinite(r.margin) ? fmtPct(r.margin) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span>
              Page {pageSafe + 1} of {totalPages}
            </span>
            <div>
              <button type="button" disabled={pageSafe === 0} onClick={() => setPage(pageSafe - 1)}>
                ‹ Prev
              </button>{' '}
              <button
                type="button"
                disabled={pageSafe >= totalPages - 1}
                onClick={() => setPage(pageSafe + 1)}
              >
                Next ›
              </button>
            </div>
          </div>
        </div>

        <div>
          <div className="panel">
            <h3>
              Billing Progress{' '}
              <span className="tag">
                {month ? `${monthLabel(month)} billed vs. total contract` : 'billed vs contract'}
              </span>
            </h3>
            <div className="chart-wrap">
              <DoughnutChart
                labels={[month ? `Billed (${monthLabel(month)})` : 'Billed', 'Remaining']}
                values={[billedTotal, remaining]}
                colors={[palette.gold, '#E4E8EE']}
              />
            </div>
          </div>
          <div className="panel">
            <h3>
              Profit Margin <span className="tag">profit vs cost</span>
            </h3>
            <div className="chart-wrap">
              <DoughnutChart
                labels={['Profit', 'Cost']}
                values={[profitPos, costBasis]}
                colors={[palette.green, '#E4E8EE']}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-3">
        <div className="panel">
          <h3>
            Top Clients{' '}
            <span className="tag">
              by billed ${month ? `, ${monthLabel(month)}, filtered` : ', filtered'}
            </span>
          </h3>
          <div className="chart-wrap tall">
            <HBarChart
              labels={clientTop.map((c) => c[0])}
              values={clientTop.map((c) => c[1])}
              color={palette.navy}
            />
          </div>
        </div>
        <div className="panel">
          <h3>
            Contract Value by Phase <span className="tag">filtered</span>
          </h3>
          <div className="chart-wrap tall">
            <HBarChart
              labels={phaseTop.map((p) => p[0])}
              values={phaseTop.map((p) => p[1])}
              color={palette.teal}
            />
          </div>
        </div>
        <div className="panel">
          <h3>
            Top Project Managers <span className="tag">by contract $, filtered</span>
          </h3>
          <div className="chart-wrap tall">
            <HBarChart
              labels={mgrTop.map((m) => m[0])}
              values={mgrTop.map((m) => m[1])}
              color={palette.gold}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
