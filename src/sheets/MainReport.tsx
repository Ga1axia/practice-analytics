import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import GridLayout, {
  useContainerWidth,
  verticalCompactor,
  type Layout,
} from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { GaugeRing, HBarChart, VBarChart } from '../components/Charts';
import { fmtUSD, fmtUSDk, palette } from '../lib/format';
import {
  managerInitials,
  phaseAbbrev,
  statusAbbrev,
  typeAbbrev,
} from '../lib/phaseAbbrev';
import type { ChatViewAction } from '../lib/chatViewAction';
import { buildClientHierarchy, type ProjectNode } from '../lib/projectListHierarchy';
import { rowOutstanding, sumAmountReceivable } from '../lib/receivable';
import type { DashboardData, ProjectRow } from '../lib/types';

type ReportProject = ProjectNode & { spent: number };

const LAYOUT_KEY = 'pa-main-report-layout-v2';
const GRID_ROWS = 14;
const GRID_MARGIN: [number, number] = [6, 6];

/** Default: filters wide enough for Manager, project table tall, no dead bands. */
const DEFAULT_LAYOUT: Layout = [
  { i: 'kpis', x: 0, y: 0, w: 7, h: 2, minW: 4, minH: 1 },
  { i: 'filters', x: 7, y: 0, w: 5, h: 2, minW: 3, minH: 2 },
  { i: 'table', x: 0, y: 2, w: 8, h: 8, minW: 4, minH: 4 },
  { i: 'gauges', x: 8, y: 2, w: 4, h: 8, minW: 2, minH: 3 },
  { i: 'client', x: 0, y: 10, w: 3, h: 4, minW: 2, minH: 2 },
  { i: 'budget', x: 3, y: 10, w: 3, h: 4, minW: 2, minH: 2 },
  { i: 'team', x: 6, y: 10, w: 3, h: 4, minW: 2, minH: 2 },
  { i: 'billable', x: 9, y: 10, w: 3, h: 4, minW: 2, minH: 2 },
];

const LAYOUT_IDS = new Set(DEFAULT_LAYOUT.map((l) => l.i));

function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return DEFAULT_LAYOUT.map((l) => ({ ...l }));
    const parsed = JSON.parse(raw) as Layout;
    if (!Array.isArray(parsed) || parsed.length < 4) return DEFAULT_LAYOUT.map((l) => ({ ...l }));
    const byId = new Map(parsed.map((l) => [l.i, l]));
    // Merge so new tiles / defaults aren’t lost from older saves
    return DEFAULT_LAYOUT.map((def) => {
      const saved = byId.get(def.i);
      if (!saved) return { ...def };
      return {
        ...def,
        ...saved,
        i: def.i,
        minW: def.minW,
        minH: def.minH,
      };
    }).filter((l) => LAYOUT_IDS.has(l.i));
  } catch {
    return DEFAULT_LAYOUT.map((l) => ({ ...l }));
  }
}

function Tile({
  title,
  tag,
  children,
  bodyClass,
}: {
  title: string;
  tag?: string;
  children: ReactNode;
  bodyClass?: string;
}) {
  return (
    <div className="mr-tile panel">
      <div className="mr-panel-drag">
        <h3>
          {title}
          {tag ? <span className="tag">{tag}</span> : null}
        </h3>
      </div>
      <div className={`mr-tile-body${bodyClass ? ` ${bodyClass}` : ''}`}>{children}</div>
    </div>
  );
}

/** Click-focus scopes KPIs + charts to a project or a single phase. */
type Focus =
  | { kind: 'project'; projectKey: string }
  | { kind: 'phase'; projectKey: string; phaseKey: string }
  | null;

function detailRows(rows: ProjectRow[]) {
  const phases = rows.filter((r) => r.row_kind === 'phase' || !r.row_kind);
  const headers = rows.filter((r) => r.row_kind === 'project');
  if (headers.length && phases.length) return phases;
  return rows;
}

function spentOf(r: ProjectRow) {
  // Prefer dollar spent; Project List mirrors billed into spent when unknown
  return r.spent || 0;
}

export function MainReport({
  data,
  lockedEmployee,
  viewAction,
}: {
  data: DashboardData;
  lockedEmployee?: string | null;
  /** AI / chat-driven filter requests (seq bumps on each apply). */
  viewAction?: { seq: number; action: ChatViewAction } | null;
}) {
  const [projectFilter, setProjectFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState('');
  const [manager, setManager] = useState(lockedEmployee || '');
  const [selectedManagers, setSelectedManagers] = useState<Set<string>>(new Set());
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<Focus>(null);
  const [layout, setLayout] = useState<Layout>(() => loadLayout());
  const [gridH, setGridH] = useState(0);
  const { width, containerRef, mounted, measureWidth } = useContainerWidth({
    measureBeforeMount: false,
    initialWidth: typeof window !== 'undefined' ? window.innerWidth : 1280,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const h = el.clientHeight;
      const w = el.clientWidth;
      if (h > 40) setGridH(h);
      if (w > 40) measureWidth();
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    // Remeasure after layout settles (flex parents often report 0 on first paint)
    const t = window.setTimeout(measure, 50);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [containerRef, measureWidth]);

  const effectiveHeight = gridH > 40 ? gridH : Math.max(480, (typeof window !== 'undefined' ? window.innerHeight : 800) - 120);
  const effectiveWidth = width > 40 ? width : typeof window !== 'undefined' ? window.innerWidth - 16 : 1280;

  const rowHeight = useMemo(() => {
    const my = GRID_MARGIN[1];
    const totalMargin = my * (GRID_ROWS + 1);
    return Math.max(18, Math.floor((effectiveHeight - totalMargin) / GRID_ROWS));
  }, [effectiveHeight]);

  function onLayoutChange(next: Layout) {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function resetLayout() {
    setLayout(DEFAULT_LAYOUT);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(DEFAULT_LAYOUT));
    } catch {
      /* ignore */
    }
  }

  const hierarchy = useMemo(() => buildClientHierarchy(data.projects), [data.projects]);

  const clientOptions = useMemo(
    () => hierarchy.map((c) => c.client).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    [hierarchy],
  );

  const clientByProject = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of hierarchy) {
      for (const p of c.projects) map.set(p.key, c.client);
    }
    return map;
  }, [hierarchy]);

  const allProjects = useMemo(
    () =>
      hierarchy
        .flatMap((c) => c.projects)
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })),
    [hierarchy],
  );

  const lastViewSeq = useRef(0);
  // Apply AI / "show me …" filter commands from the floating chat (once per seq).
  useEffect(() => {
    if (!viewAction || viewAction.seq === lastViewSeq.current) return;
    lastViewSeq.current = viewAction.seq;
    const a = viewAction.action;
    if (a.clear) {
      setProjectFilter('');
      setClientFilter('');
      setStatus('');
      setPhase('');
      if (!lockedEmployee) {
        setManager('');
        setSelectedManagers(new Set());
      }
      setFocus(null);
      return;
    }
    if (a.project != null) setProjectFilter(a.project);
    if (a.client != null) {
      setClientFilter(a.client);
      if (a.project == null) setProjectFilter('');
    }
    if (a.status != null) setStatus(a.status);
    if (a.phase != null) setPhase(a.phase);
    if (a.manager != null && !lockedEmployee) {
      setManager(a.manager);
      setSelectedManagers(new Set());
    }
  }, [viewAction, lockedEmployee]);

  const phaseOptions = useMemo(() => {
    const set = new Set<string>();
    data.projects.forEach((r) => {
      if (r.phase && r.phase !== 'Other') set.add(r.phase);
    });
    return [...set].sort();
  }, [data.projects]);

  const managerOptions = useMemo(() => {
    if (Object.keys(data.employee_roster).length) {
      return Object.values(data.employee_roster).flat().sort();
    }
    return data.managers;
  }, [data]);

  const filteredProjects = useMemo(() => {
    const out: ReportProject[] = [];
    for (const p of allProjects) {
      if (projectFilter && p.key !== projectFilter) continue;
      if (clientFilter && clientByProject.get(p.key) !== clientFilter) continue;

      const phases = p.phases.filter((ph) => {
        if (status && (ph.row.status || 'ACTIVE') !== status) return false;
        if (phase && (ph.row.phase || '') !== phase) return false;
        if (manager && ph.row.manager !== manager) return false;
        if (selectedManagers.size && !selectedManagers.has(ph.row.manager || '')) return false;
        return true;
      });

      const hasPhaseFilters = !!(manager || selectedManagers.size || status || phase);
      const shownPhases = hasPhaseFilters ? phases : p.phases;
      if (hasPhaseFilters && !shownPhases.length) {
        if (!p.row) continue;
        const hdrOk =
          (!status || (p.row.status || 'ACTIVE') === status) &&
          (!manager || p.row.manager === manager) &&
          (!selectedManagers.size || selectedManagers.has(p.row.manager || ''));
        if (!hdrOk || phase) continue;
      }

      const contract = shownPhases.length
        ? shownPhases.reduce((a, x) => a + (x.row.contract || 0), 0)
        : p.contract;
      const billed = shownPhases.length
        ? shownPhases.reduce((a, x) => a + (x.row.billed || 0), 0)
        : p.billed;
      const outstanding = shownPhases.length
        ? shownPhases.reduce((a, x) => a + rowOutstanding(x.row), 0)
        : p.outstanding;
      const billedHours = shownPhases.length
        ? shownPhases.reduce((a, x) => a + (x.row.billed_hours || 0), 0)
        : p.billedHours;
      const spentHours = shownPhases.length
        ? shownPhases.reduce((a, x) => a + (x.row.spent_hours || 0), 0)
        : p.spentHours;
      const spent = shownPhases.length
        ? shownPhases.reduce((a, x) => a + spentOf(x.row), 0)
        : spentOf(p.row || ({ spent: 0 } as ProjectRow));

      out.push({
        ...p,
        phases: shownPhases,
        contract,
        billed,
        outstanding,
        billedHours,
        spentHours,
        spent,
      });
    }
    out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    return out;
  }, [allProjects, projectFilter, clientFilter, clientByProject, status, phase, manager, selectedManagers]);

  // Dropdown project filter → expand phases + scope KPIs to that project.
  useEffect(() => {
    if (!projectFilter) return;
    setOpenProjects(new Set([projectFilter]));
    setFocus({ kind: 'project', projectKey: projectFilter });
  }, [projectFilter]);

  const onlyProjectKey = filteredProjects.length === 1 ? filteredProjects[0]!.key : '';
  // If filters leave a single project, keep its phases expanded.
  useEffect(() => {
    if (projectFilter || !onlyProjectKey) return;
    setOpenProjects(new Set([onlyProjectKey]));
  }, [projectFilter, onlyProjectKey]);

  const filteredRows = useMemo(() => {
    const rows: ProjectRow[] = [];
    filteredProjects.forEach((p) => {
      p.phases.forEach((ph) => rows.push(ph.row));
      if (!p.phases.length && p.row) rows.push(p.row);
    });
    return rows.length ? rows : detailRows(data.projects);
  }, [filteredProjects, data.projects]);

  /** Rows driving KPIs + charts — narrowed by click focus when set. */
  const scopedRows = useMemo(() => {
    if (!focus) return filteredRows;
    if (focus.kind === 'phase') {
      return filteredRows.filter((r) => r.project === focus.phaseKey);
    }
    const proj = filteredProjects.find((p) => p.key === focus.projectKey);
    if (!proj) return filteredRows;
    if (proj.phases.length) return proj.phases.map((ph) => ph.row);
    return proj.row ? [proj.row] : filteredRows;
  }, [focus, filteredRows, filteredProjects]);

  const focusLabel = useMemo(() => {
    if (!focus) return null;
    const proj = filteredProjects.find((p) => p.key === focus.projectKey);
    if (!proj) return null;
    if (focus.kind === 'project') {
      return proj.code ? `${proj.title} (${proj.code})` : proj.title;
    }
    const ph = proj.phases.find((x) => x.row.project === focus.phaseKey);
    return ph ? `${proj.title} · ${ph.label}` : proj.title;
  }, [focus, filteredProjects]);

  const kpis = useMemo(() => {
    const rows = scopedRows;
    const contract = rows.reduce((a, r) => a + (r.contract || 0), 0);
    const spent = rows.reduce((a, r) => a + spentOf(r), 0);
    const billed = rows.reduce((a, r) => a + (r.billed || 0), 0);
    const recv = sumAmountReceivable(rows, data.ar_clients);
    const receivable = recv.amount;
    const retainer = rows.reduce((a, r) => a + (r.retainer_balance || 0), 0);
    const billedHours = rows.reduce((a, r) => a + (r.billed_hours || 0), 0);
    const spentHours = rows.reduce((a, r) => a + (r.spent_hours || 0), 0);
    const profit = rows.reduce((a, r) => a + (r.profit || 0), 0);
    const cost = Math.max(billed - Math.max(profit, 0), 0);
    return {
      contract,
      spent,
      billed,
      receivable,
      receivableSource: recv.source,
      retainer,
      billedHours,
      spentHours,
      profit,
      cost,
      // Billing ring: billed / contract
      billingPct: contract > 0 ? billed / contract : 0,
      // Earned value proxy: spent / contract (over-burn shows >100%)
      earnedPct: contract > 0 ? spent / contract : 0,
      // Margin: profit/billed when profit exists; else unavailable → 0
      marginPct: billed > 0 && profit ? profit / billed : 0,
      // Utilization proxy: billed hrs / spent hrs
      utilPct: spentHours > 0 ? billedHours / spentHours : 0,
      workInHand: contract - spent,
      balance: receivable,
      nonBillableHours: Math.max(spentHours - billedHours, 0),
    };
  }, [scopedRows, data.ar_clients]);

  const clientPerf = useMemo(() => {
    const map: Record<string, number> = {};
    scopedRows.forEach((r) => {
      const c = r.client || 'Unassigned';
      map[c] = (map[c] || 0) + (r.billed || 0);
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }, [scopedRows]);

  const phaseBudget = useMemo(() => {
    const map: Record<string, { contract: number; spent: number; billed: number }> = {};
    scopedRows.forEach((r) => {
      const p = r.phase || 'Other';
      if (p === 'Other') return;
      if (!map[p]) map[p] = { contract: 0, spent: 0, billed: 0 };
      map[p].contract += r.contract || 0;
      map[p].spent += spentOf(r);
      map[p].billed += r.billed || 0;
    });
    return Object.entries(map)
      .map(([name, v]) => ({
        name,
        ...v,
        pct: v.contract > 0 ? v.spent / v.contract : 0,
      }))
      .sort((a, b) => b.contract - a.contract)
      .slice(0, 6);
  }, [scopedRows]);

  const billableAnalysis = useMemo(() => {
    const billed = kpis.billed;
    const outstanding = kpis.receivable;
    const unbilled = Math.max(kpis.spent - billed, 0);
    return {
      labels: ['Billable', 'Billed', 'UB', 'NR'],
      values: [Math.max(kpis.spent, billed), billed, unbilled, outstanding],
    };
  }, [kpis]);

  function selectProject(key: string) {
    setOpenProjects((prev) => {
      const next = new Set(prev);
      next.add(key); // always expand when selecting
      return next;
    });
    setFocus((prev) =>
      prev?.kind === 'project' && prev.projectKey === key ? null : { kind: 'project', projectKey: key },
    );
  }

  function selectPhase(projectKey: string, phaseKey: string) {
    setOpenProjects((prev) => new Set(prev).add(projectKey));
    setFocus((prev) =>
      prev?.kind === 'phase' && prev.phaseKey === phaseKey
        ? { kind: 'project', projectKey }
        : { kind: 'phase', projectKey, phaseKey },
    );
  }

  function toggleExpandOnly(key: string, e: MouseEvent) {
    e.stopPropagation();
    setOpenProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function onProjectFilterChange(value: string) {
    setProjectFilter(value);
    if (!value) setFocus(null);
  }

  function clearFocus() {
    if (focus?.kind === 'phase') {
      setFocus({ kind: 'project', projectKey: focus.projectKey });
      return;
    }
    setFocus(null);
    setProjectFilter('');
    setClientFilter('');
  }

  function toggleTeamMember(name: string) {
    setSelectedManagers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const displayProjects = filteredProjects;
  const forceOpen = !!projectFilter || filteredProjects.length === 1;

  return (
    <section className="sheet active main-report main-report-fill">
      {focusLabel ? (
        <div className="mr-scope-bar">
          <span className="mono">
            Viewing {focus?.kind === 'phase' ? 'phase' : 'project'}:
          </span>
          <strong>{focusLabel}</strong>
          <button type="button" className="reset-btn" onClick={clearFocus}>
            {focus?.kind === 'phase' ? 'Back to project' : 'Show all'}
          </button>
        </div>
      ) : null}

      <div className="mr-grid-host" ref={containerRef}>
        {mounted || effectiveWidth > 0 ? (
          <GridLayout
            width={effectiveWidth}
            layout={layout}
            onLayoutChange={onLayoutChange}
            gridConfig={{
              cols: 12,
              rowHeight,
              margin: GRID_MARGIN,
              containerPadding: [0, 0],
              maxRows: GRID_ROWS,
            }}
            dragConfig={{
              enabled: true,
              bounded: true,
              handle: '.mr-panel-drag',
              cancel: 'input,select,button,textarea,a,table,.mr-table-scroll,.mr-team',
              threshold: 4,
            }}
            resizeConfig={{
              enabled: true,
              handles: ['se', 'e', 's'],
            }}
            compactor={verticalCompactor}
            autoSize={false}
            className="mr-grid"
            style={{ height: effectiveHeight }}
          >
            <div key="kpis">
              <div className="mr-tile mr-kpi-tile">
                <div className="mr-panel-drag mr-kpi-drag mono">KPIs · drag</div>
                <div className="mr-kpi-row">
                  <div className="mr-kpi">
                    <div className="k">Contract Amount</div>
                    <div className="v">{fmtUSD(kpis.contract)}</div>
                    <div className="sub">
                      Retainer <strong>{fmtUSD(kpis.retainer)}</strong>
                    </div>
                  </div>
                  <div className="mr-kpi">
                    <div className="k">Spent</div>
                    <div className="v">{fmtUSD(kpis.spent)}</div>
                  </div>
                  <div className="mr-kpi">
                    <div className="k">Billed</div>
                    <div className="v">{fmtUSD(kpis.billed)}</div>
                  </div>
                  <div className="mr-kpi accent">
                    <div className="k">Receivable</div>
                    <div className="v">{fmtUSD(kpis.receivable)}</div>
                  </div>
                </div>
              </div>
            </div>

            <div key="filters">
              <Tile title="Filters" tag="drag header to move">
                <div className="mr-filters compact">
                  <label>
                    <span>Client</span>
                    <select
                      value={clientFilter}
                      onChange={(e) => {
                        setClientFilter(e.target.value);
                        setProjectFilter('');
                        setFocus(null);
                      }}
                    >
                      <option value="">All</option>
                      {clientOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Manager</span>
                    <select
                      value={manager}
                      onChange={(e) => setManager(e.target.value)}
                      disabled={!!lockedEmployee}
                    >
                      <option value="">All</option>
                      {managerOptions.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Project</span>
                    <select
                      value={projectFilter}
                      onChange={(e) => onProjectFilterChange(e.target.value)}
                    >
                      <option value="">All</option>
                      {allProjects
                        .filter((p) => !clientFilter || clientByProject.get(p.key) === clientFilter)
                        .map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.title}
                          {p.code ? ` (${p.code})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Status</span>
                    <select value={status} onChange={(e) => setStatus(e.target.value)}>
                      <option value="">All</option>
                      {(data.statuses.length ? data.statuses : ['ACTIVE']).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Phase</span>
                    <select value={phase} onChange={(e) => setPhase(e.target.value)}>
                      <option value="">All</option>
                      {phaseOptions.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="reset-btn" onClick={resetLayout}>
                    Reset layout
                  </button>
                </div>
              </Tile>
            </div>

            <div key="table">
              <Tile
                title="Project details"
                tag={`${displayProjects.length.toLocaleString()} projects · click to scope`}
                bodyClass="mr-table-body"
              >
                <div className="table-scroll mr-table-scroll">
                  <table className="data mr-table">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>City</th>
                        <th>Lead</th>
                        <th>Phs</th>
                        <th>Sts</th>
                        <th>Typ</th>
                        <th className="num">Contract</th>
                        <th className="num">Spent</th>
                        <th className="num">%</th>
                        <th className="num">Billed</th>
                        <th className="num">Bdgt Hrs</th>
                        <th className="num">Spnt Hrs</th>
                        <th className="num">Blnc Hrs</th>
                        <th className="num">Rtnr</th>
                        <th className="num">Outstd</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayProjects.map((p) => {
                        const open = forceOpen || openProjects.has(p.key);
                        const projSelected =
                          focus?.kind === 'project' && focus.projectKey === p.key;
                        const pct = p.contract > 0 ? p.spent / p.contract : 0;
                        const balHrs = Math.max(
                          (p.billedHours || 0) - (p.spentHours || 0),
                          0,
                        );
                        return (
                          <Fragment key={p.key}>
                            <tr
                              className={`mr-proj-row${projSelected ? ' selected' : ''}`}
                              onClick={() => selectProject(p.key)}
                            >
                              <td>
                                <button
                                  type="button"
                                  className="mr-chevron mono"
                                  aria-label={open ? 'Collapse' : 'Expand'}
                                  onClick={(e) => toggleExpandOnly(p.key, e)}
                                >
                                  {open ? '▾' : '▸'}
                                </button>
                                {p.title}
                                {p.code ? (
                                  <span className="plist-code mono">{p.code}</span>
                                ) : null}
                              </td>
                              <td>{p.row?.city || '—'}</td>
                              <td className="mono">{managerInitials(p.row?.manager)}</td>
                              <td className="mono">—</td>
                              <td className="mono">
                                {statusAbbrev(p.row?.status || 'ACTIVE')}
                              </td>
                              <td className="mono">{typeAbbrev(p.row?.type)}</td>
                              <td className="num">{fmtUSD(p.contract)}</td>
                              <td className="num">{fmtUSD(p.spent)}</td>
                              <td className="num">{Math.round(pct * 100)}%</td>
                              <td className="num">{fmtUSD(p.billed)}</td>
                              <td className="num">{(p.billedHours || 0).toFixed(0)}</td>
                              <td className="num">{(p.spentHours || 0).toFixed(0)}</td>
                              <td className="num">{balHrs.toFixed(0)}</td>
                              <td className="num">
                                {fmtUSD(p.row?.retainer_balance || 0)}
                              </td>
                              <td className="num">{fmtUSD(p.outstanding)}</td>
                            </tr>
                            {open
                              ? p.phases.map((ph) => {
                                  const r = ph.row;
                                  const sp = spentOf(r);
                                  const pPct = r.contract > 0 ? sp / r.contract : 0;
                                  const bh = r.billed_hours || 0;
                                  const sh = r.spent_hours || 0;
                                  const phaseSelected =
                                    focus?.kind === 'phase' &&
                                    focus.phaseKey === r.project;
                                  return (
                                    <tr
                                      key={r.project}
                                      className={`mr-phase-row${phaseSelected ? ' selected' : ''}`}
                                      onClick={() => selectPhase(p.key, r.project)}
                                    >
                                      <td className="mr-phase-name">{ph.label}</td>
                                      <td>{r.city || '—'}</td>
                                      <td className="mono">
                                        {managerInitials(r.manager)}
                                      </td>
                                      <td className="mono">
                                        {phaseAbbrev(r.phase || ph.label)}
                                      </td>
                                      <td className="mono">
                                        {statusAbbrev(r.status || 'ACTIVE')}
                                      </td>
                                      <td className="mono">{typeAbbrev(r.type)}</td>
                                      <td className="num">{fmtUSD(r.contract)}</td>
                                      <td className="num">{fmtUSD(sp)}</td>
                                      <td className="num">{Math.round(pPct * 100)}%</td>
                                      <td className="num">{fmtUSD(r.billed)}</td>
                                      <td className="num">{bh.toFixed(0)}</td>
                                      <td className="num">{sh.toFixed(0)}</td>
                                      <td className="num">
                                        {Math.max(bh - sh, 0).toFixed(0)}
                                      </td>
                                      <td className="num">
                                        {fmtUSD(r.retainer_balance || 0)}
                                      </td>
                                      <td className="num">
                                        {fmtUSD(rowOutstanding(r))}
                                      </td>
                                    </tr>
                                  );
                                })
                              : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Tile>
            </div>

            <div key="gauges">
              <Tile title="Performance rings" tag="scoped">
                <div className="mr-gauges fill">
                  <div className="mr-gauge">
                    <div className="mr-gauge-label mono">Billing</div>
                    <GaugeRing pct={kpis.billingPct} color={palette.gold} />
                    <dl className="mr-gauge-stats">
                      <div>
                        <dt>Billed</dt>
                        <dd>{fmtUSD(kpis.billed)}</dd>
                      </div>
                      <div>
                        <dt>Contract</dt>
                        <dd>{fmtUSD(kpis.contract)}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="mr-gauge">
                    <div className="mr-gauge-label mono">Earned</div>
                    <GaugeRing
                      pct={kpis.earnedPct}
                      color={kpis.earnedPct > 1 ? palette.rust : palette.teal}
                    />
                    <dl className="mr-gauge-stats">
                      <div>
                        <dt>Spent</dt>
                        <dd>{fmtUSD(kpis.spent)}</dd>
                      </div>
                      <div>
                        <dt>WIP</dt>
                        <dd>{fmtUSD(kpis.workInHand)}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="mr-gauge">
                    <div className="mr-gauge-label mono">Margin</div>
                    <GaugeRing pct={kpis.marginPct} color={palette.green} />
                    <dl className="mr-gauge-stats">
                      <div>
                        <dt>Profit</dt>
                        <dd>{kpis.profit ? fmtUSD(kpis.profit) : '—'}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="mr-gauge">
                    <div className="mr-gauge-label mono">Utilization</div>
                    <GaugeRing pct={kpis.utilPct} color="#3A6EA5" />
                    <dl className="mr-gauge-stats">
                      <div>
                        <dt>Billable</dt>
                        <dd>{kpis.billedHours.toFixed(0)}h</dd>
                      </div>
                      <div>
                        <dt>Total</dt>
                        <dd>{kpis.spentHours.toFixed(0)}h</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </Tile>
            </div>

            <div key="client">
              <Tile title="Client performance" tag="net billed">
                <div className="chart-wrap fill">
                  <HBarChart
                    labels={clientPerf.map((c) => c[0])}
                    values={clientPerf.map((c) => c[1])}
                    color={palette.navy}
                  />
                </div>
              </Tile>
            </div>

            <div key="budget">
              <Tile title="Budget analysis" tag="by phase">
                <div className="mr-budget-list">
                  {phaseBudget.length === 0 ? (
                    <div className="plist-empty">No phase data</div>
                  ) : (
                    phaseBudget.map((p) => (
                      <div key={p.name} className="mr-budget-row">
                        <div className="mr-budget-label">
                          <span>{p.name}</span>
                          <span className="mono">
                            {fmtUSDk(p.spent)} / {fmtUSDk(p.contract)}
                          </span>
                        </div>
                        <div className="mr-budget-track">
                          <div
                            className="mr-budget-fill"
                            style={{
                              width: `${Math.min(p.pct * 100, 100)}%`,
                              background:
                                p.pct > 1
                                  ? palette.rust
                                  : p.pct > 0.85
                                    ? palette.gold
                                    : palette.green,
                            }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Tile>
            </div>

            <div key="team">
              <Tile title="Team members" tag="filter">
                <div className="mr-team">
                  {managerOptions.slice(0, 24).map((name) => {
                    const on = selectedManagers.has(name) || manager === name;
                    return (
                      <label key={name} className={`mr-team-item ${on ? 'on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selectedManagers.has(name)}
                          disabled={!!lockedEmployee}
                          onChange={() => toggleTeamMember(name)}
                        />
                        <span>{name}</span>
                      </label>
                    );
                  })}
                </div>
              </Tile>
            </div>

            <div key="billable">
              <Tile title="Billable analysis" tag="proxy">
                <div className="chart-wrap fill">
                  <VBarChart
                    labels={billableAnalysis.labels}
                    datasets={[
                      {
                        label: 'Amount',
                        values: billableAnalysis.values,
                        color: palette.navy,
                      },
                    ]}
                  />
                </div>
              </Tile>
            </div>
          </GridLayout>
        ) : null}
      </div>
    </section>
  );
}
