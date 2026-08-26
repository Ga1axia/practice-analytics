import { useMemo, useState } from 'react';
import { BqeConnectPanel } from '../components/BqeConnectPanel';
import { HBarChart, StackedCountHBar, StackedValueHBar } from '../components/Charts';
import { KpiRow } from '../components/KpiRow';
import { useAuth } from '../hooks/useAuth';
import { isAdminRole } from '../lib/roles';
import {
  matchProcessPhaseIndex,
  PROCESS_PHASES,
} from '../lib/architecturalProcess';
import { fmtUSDk, palette } from '../lib/format';
import { buildClientHierarchy } from '../lib/projectListHierarchy';
import { rowOutstanding } from '../lib/receivable';
import type { DashboardData, ProjectRow } from '../lib/types';
import {
  classifyWorkType,
  WORK_TYPE_COLORS,
  WORK_TYPES,
  type WorkType,
} from '../lib/workType';

const PHASE_KEYS = PROCESS_PHASES.map((p) => p.shortName);

type LoadSort = 'load' | 'city';

type EmpPhaseLoad = {
  name: string;
  city: string;
  phaseCounts: Record<string, number>;
  phaseContracts: Record<string, number>;
  typeCounts: Record<WorkType, number>;
  typeContracts: Record<WorkType, number>;
  phaseTotal: number;
  contractTotal: number;
  projectTotal: number;
};

function phaseBucket(phase: string | null | undefined): string {
  const idx = matchProcessPhaseIndex(phase);
  if (idx >= 0) return PROCESS_PHASES[idx]!.shortName;
  return PROCESS_PHASES.find((p) => p.id === 'additional')?.shortName || 'Add. Services';
}

function phaseColor(key: string): string {
  return PROCESS_PHASES.find((p) => p.shortName === key)?.color || '#9AA8B5';
}

function emptyPhaseMap(): Record<string, number> {
  return Object.fromEntries(PHASE_KEYS.map((k) => [k, 0]));
}

function emptyTypeMap(): Record<WorkType, number> {
  return Object.fromEntries(WORK_TYPES.map((k) => [k, 0])) as Record<WorkType, number>;
}

function projectKeyOf(r: ProjectRow): string {
  return r.parent_project || r.project;
}

function cityOf(r: ProjectRow): string {
  const c = (r.city || '').trim();
  return c || 'Unspecified';
}

/** Mode city across an employee's active project cities. */
function primaryCity(cityHits: Map<string, number>): string {
  let best = 'Unspecified';
  let n = -1;
  for (const [city, count] of cityHits) {
    if (count > n || (count === n && city.localeCompare(best) < 0)) {
      best = city;
      n = count;
    }
  }
  return best;
}

function sortEmployees(rows: EmpPhaseLoad[], sort: LoadSort, by: 'phase' | 'contract' | 'type') {
  return [...rows].sort((a, b) => {
    if (sort === 'city') {
      const c = a.city.localeCompare(b.city, undefined, { sensitivity: 'base' });
      if (c !== 0) return c;
    }
    const av =
      by === 'phase' ? a.phaseTotal : by === 'contract' ? a.contractTotal : a.projectTotal;
    const bv =
      by === 'phase' ? b.phaseTotal : by === 'contract' ? b.contractTotal : b.projectTotal;
    return bv - av || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function seriesFromMaps(
  employees: EmpPhaseLoad[],
  keys: string[],
  pick: (e: EmpPhaseLoad, key: string) => number,
  colorOf: (key: string) => string,
) {
  const used = keys.filter((k) => employees.some((e) => pick(e, k) > 0));
  return used.map((key) => ({
    label: key,
    color: colorOf(key),
    values: employees.map((e) => pick(e, key)),
  }));
}

export function Executive({ data }: { data: DashboardData }) {
  const { profile } = useAuth();
  const isAdmin = isAdminRole(profile?.role);
  const [loadSort, setLoadSort] = useState<LoadSort>('load');
  const [typeMetric, setTypeMetric] = useState<'count' | 'contract'>('count');

  const hierarchy = useMemo(() => buildClientHierarchy(data.projects), [data.projects]);

  const summary = useMemo(() => {
    const clients = hierarchy.length;
    const projects = hierarchy.reduce((a, c) => a + c.projects.length, 0);
    const phases = hierarchy.reduce((a, c) => a + c.phaseCount, 0);
    const contract = data.kpi_all.contract_amount;
    const billed = data.kpi_all.billed;
    const outstanding = data.projects
      .filter((r) => r.row_kind !== 'project')
      .reduce((a, r) => a + Math.max(0, rowOutstanding(r)), 0);
    const billedHours = data.projects.reduce((a, r) => a + (r.billed_hours || 0), 0);
    const spentHours = data.projects.reduce((a, r) => a + (r.spent_hours || 0), 0);
    return { clients, projects, phases, contract, billed, outstanding, billedHours, spentHours };
  }, [data, hierarchy]);

  const topClients = useMemo(
    () =>
      [...hierarchy]
        .sort((a, b) => b.contract - a.contract)
        .slice(0, 10)
        .map((c) => [c.client, c.contract] as [string, number]),
    [hierarchy],
  );

  /** Active workload per employee — phases, contract $, work type, city. */
  const employeeLoad = useMemo(() => {
    type Acc = {
      phaseCounts: Record<string, number>;
      phaseContracts: Record<string, number>;
      typeCounts: Record<WorkType, number>;
      typeContracts: Record<WorkType, number>;
      cityHits: Map<string, number>;
      projects: Set<string>;
    };
    const byEmp = new Map<string, Acc>();

    const ensure = (name: string): Acc => {
      let row = byEmp.get(name);
      if (!row) {
        row = {
          phaseCounts: emptyPhaseMap(),
          phaseContracts: emptyPhaseMap(),
          typeCounts: emptyTypeMap(),
          typeContracts: emptyTypeMap(),
          cityHits: new Map(),
          projects: new Set(),
        };
        byEmp.set(name, row);
      }
      return row;
    };

    // City / type from project headers when available
    const projectMeta = new Map<string, { city: string; type: WorkType; title: string }>();
    for (const r of data.projects) {
      if (r.row_kind !== 'project') continue;
      projectMeta.set(r.project, {
        city: cityOf(r),
        type: classifyWorkType(r.project, r.type),
        title: r.project,
      });
    }

    for (const r of data.projects) {
      if (!r.manager || r.row_kind === 'project') continue;
      const phase = (r.phase || '').trim();
      if (!phase || phase === 'Internal/PTO') continue;
      if ((r.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') continue;

      const acc = ensure(r.manager);
      const bucket = phaseBucket(phase);
      acc.phaseCounts[bucket] = (acc.phaseCounts[bucket] || 0) + 1;
      acc.phaseContracts[bucket] = (acc.phaseContracts[bucket] || 0) + (r.contract || 0);

      const pk = projectKeyOf(r);
      const meta = projectMeta.get(pk);
      const city = meta?.city || cityOf(r);
      const workType = meta?.type || classifyWorkType(pk || r.project, r.type);
      acc.cityHits.set(city, (acc.cityHits.get(city) || 0) + 1);

      if (!acc.projects.has(pk)) {
        acc.projects.add(pk);
        acc.typeCounts[workType] = (acc.typeCounts[workType] || 0) + 1;
      }
      // Attribute phase contract to work type as well
      acc.typeContracts[workType] = (acc.typeContracts[workType] || 0) + (r.contract || 0);
    }

    return [...byEmp.entries()]
      .map(([name, acc]) => {
        const phaseTotal = PHASE_KEYS.reduce((a, k) => a + (acc.phaseCounts[k] || 0), 0);
        const contractTotal = PHASE_KEYS.reduce((a, k) => a + (acc.phaseContracts[k] || 0), 0);
        return {
          name,
          city: primaryCity(acc.cityHits),
          phaseCounts: acc.phaseCounts,
          phaseContracts: acc.phaseContracts,
          typeCounts: acc.typeCounts,
          typeContracts: acc.typeContracts,
          phaseTotal,
          contractTotal,
          projectTotal: acc.projects.size,
        } satisfies EmpPhaseLoad;
      })
      .filter((e) => e.phaseTotal > 0);
  }, [data.projects]);

  const phaseCountChart = useMemo(() => {
    const employees = sortEmployees(employeeLoad, loadSort, 'phase').slice(0, 16);
    return {
      labels: employees.map((e) =>
        loadSort === 'city' ? `${e.city} · ${e.name}` : e.name,
      ),
      series: seriesFromMaps(
        employees,
        PHASE_KEYS,
        (e, k) => e.phaseCounts[k] || 0,
        phaseColor,
      ),
    };
  }, [employeeLoad, loadSort]);

  const phaseContractChart = useMemo(() => {
    const employees = sortEmployees(employeeLoad, loadSort, 'contract').slice(0, 16);
    return {
      labels: employees.map((e) =>
        loadSort === 'city' ? `${e.city} · ${e.name}` : e.name,
      ),
      series: seriesFromMaps(
        employees,
        PHASE_KEYS,
        (e, k) => e.phaseContracts[k] || 0,
        phaseColor,
      ),
    };
  }, [employeeLoad, loadSort]);

  const typeChart = useMemo(() => {
    const employees = sortEmployees(employeeLoad, loadSort, 'type').slice(0, 16);
    const pick =
      typeMetric === 'count'
        ? (e: EmpPhaseLoad, k: string) => e.typeCounts[k as WorkType] || 0
        : (e: EmpPhaseLoad, k: string) => e.typeContracts[k as WorkType] || 0;
    return {
      labels: employees.map((e) =>
        loadSort === 'city' ? `${e.city} · ${e.name}` : e.name,
      ),
      series: seriesFromMaps(employees, WORK_TYPES, pick, (k) => WORK_TYPE_COLORS[k as WorkType]),
      metric: typeMetric,
    };
  }, [employeeLoad, loadSort, typeMetric]);

  /** Active contract by city — alphabetical. */
  const cityLoad = useMemo(() => {
    const map = new Map<string, number>();

    const projectCity = new Map<string, string>();
    for (const r of data.projects) {
      if (r.row_kind === 'project') projectCity.set(r.project, cityOf(r));
    }

    for (const r of data.projects) {
      if (r.row_kind === 'project') continue;
      if ((r.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') continue;
      const phase = (r.phase || '').trim();
      if (!phase || phase === 'Internal/PTO') continue;
      const city = projectCity.get(projectKeyOf(r)) || cityOf(r);
      map.set(city, (map.get(city) || 0) + (r.contract || 0));
    }

    return [...map.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
      .slice(0, 16);
  }, [data.projects]);

  return (
    <section className="sheet active">
      {isAdmin ? <BqeConnectPanel /> : null}

      <KpiRow
        items={[
          { k: 'Clients', v: String(summary.clients) },
          { k: 'Projects', v: String(summary.projects), cls: 'accent-teal' },
          { k: 'Phases', v: String(summary.phases), cls: 'accent-gold' },
          { k: 'Contract', v: fmtUSDk(summary.contract), cls: 'accent-green' },
          { k: 'Net Billed', v: fmtUSDk(summary.billed), cls: 'accent-rust' },
          { k: 'Outstanding', v: fmtUSDk(summary.outstanding) },
        ]}
      />

      <div className="grid grid-2">
        <div className="panel">
          <h3>
            Top clients by contract
            <span className="tag">From project list</span>
          </h3>
          <div className="chart-wrap tall">
            <HBarChart
              labels={topClients.map((x) => x[0])}
              values={topClients.map((x) => x[1])}
              color={palette.navy}
            />
          </div>
        </div>
        <div className="panel">
          <h3>
            Active contract by city
            <span className="tag">Sorted A–Z</span>
          </h3>
          <div className="chart-wrap tall">
            {cityLoad.length === 0 ? (
              <div className="plist-empty">No city data on active phases</div>
            ) : (
              <HBarChart
                labels={cityLoad.map((x) => x[0])}
                values={cityLoad.map((x) => x[1])}
                color={palette.teal}
              />
            )}
          </div>
        </div>
      </div>

      <div className="panel exec-load">
        <div className="exec-load-head">
          <h3>
            Team load
            <span className="tag">Active phases · how loaded everyone is</span>
          </h3>
          <div className="exec-toggle" role="group" aria-label="Sort team load">
            <button
              type="button"
              className={loadSort === 'load' ? 'on' : ''}
              onClick={() => setLoadSort('load')}
            >
              Busiest
            </button>
            <button
              type="button"
              className={loadSort === 'city' ? 'on' : ''}
              onClick={() => setLoadSort('city')}
            >
              By city
            </button>
          </div>
        </div>

        <div className="grid grid-2 exec-load-grid">
          <div>
            <h4 className="exec-load-sub">By phase · count</h4>
            <div className="chart-wrap tall">
              {phaseCountChart.labels.length === 0 ? (
                <div className="plist-empty">No active phase assignments</div>
              ) : (
                <StackedCountHBar
                  labels={phaseCountChart.labels}
                  series={phaseCountChart.series}
                  xTitle="# of phases assigned"
                />
              )}
            </div>
          </div>
          <div>
            <h4 className="exec-load-sub">By phase · contract value</h4>
            <div className="chart-wrap tall">
              {phaseContractChart.labels.length === 0 ? (
                <div className="plist-empty">No active phase assignments</div>
              ) : (
                <StackedValueHBar
                  labels={phaseContractChart.labels}
                  series={phaseContractChart.series}
                  xTitle="Contract $"
                />
              )}
            </div>
          </div>
        </div>

        <div className="exec-load-type">
          <div className="exec-load-type-head">
            <h4 className="exec-load-sub">Per person · project type</h4>
            <div className="exec-toggle" role="group" aria-label="Project type metric">
              <button
                type="button"
                className={typeMetric === 'count' ? 'on' : ''}
                onClick={() => setTypeMetric('count')}
              >
                Projects
              </button>
              <button
                type="button"
                className={typeMetric === 'contract' ? 'on' : ''}
                onClick={() => setTypeMetric('contract')}
              >
                Contract $
              </button>
            </div>
          </div>
          <div className="chart-wrap tall">
            {typeChart.labels.length === 0 ? (
              <div className="plist-empty">No active project assignments</div>
            ) : typeMetric === 'count' ? (
              <StackedCountHBar
                labels={typeChart.labels}
                series={typeChart.series}
                xTitle="# of projects"
              />
            ) : (
              <StackedValueHBar
                labels={typeChart.labels}
                series={typeChart.series}
                xTitle="Contract $"
              />
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>
          Hours snapshot
          <span className="tag">Billed vs spent</span>
        </h3>
        <KpiRow
          items={[
            {
              k: 'Billed hours',
              v: summary.billedHours.toLocaleString('en-US', { maximumFractionDigits: 1 }),
            },
            {
              k: 'Spent hours',
              v: summary.spentHours.toLocaleString('en-US', { maximumFractionDigits: 1 }),
              cls: 'accent-teal',
            },
            {
              k: 'Utilization (hrs)',
              v:
                summary.spentHours > 0
                  ? ((summary.billedHours / summary.spentHours) * 100).toFixed(1) + '%'
                  : '—',
              cls: 'accent-gold',
            },
          ]}
        />
      </div>
    </section>
  );
}
