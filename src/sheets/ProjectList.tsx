import { useMemo, useState } from 'react';
import { KpiRow } from '../components/KpiRow';
import { fmtUSD, fmtUSDk } from '../lib/format';
import {
  buildPlistTableRows,
  filterPlistRows,
  plistScopeRows,
  type PlistHierarchyFilter,
  type ProjectStatusFilter,
} from '../lib/projectListRows';
import { rowOutstanding } from '../lib/receivable';
import { statusAbbrev } from '../lib/phaseAbbrev';
import type { DashboardData } from '../lib/types';

const STATUS_OPTIONS: { value: ProjectStatusFilter; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ALL', label: 'All' },
];

const HIERARCHY_OPTIONS: { value: PlistHierarchyFilter; label: string }[] = [
  { value: 'all', label: 'All levels' },
  { value: 'project', label: 'Projects only' },
  { value: 'phase', label: 'Phases only' },
];

export function ProjectList({
  data,
  globalSearch = '',
}: {
  data: DashboardData;
  /** Top-header global search (deterministic, all row fields). */
  globalSearch?: string;
}) {
  const [localSearch, setLocalSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProjectStatusFilter>('ACTIVE');
  const [hierarchyFilter, setHierarchyFilter] = useState<PlistHierarchyFilter>('all');
  const [manager, setManager] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionOnly, setSelectionOnly] = useState(false);

  const allRows = useMemo(() => buildPlistTableRows(data.projects), [data.projects]);

  const managers = useMemo(() => {
    const set = new Set<string>();
    data.projects.forEach((p) => {
      if (p.manager) set.add(p.manager);
    });
    return [...set].sort();
  }, [data.projects]);

  const scopeRows = useMemo(
    () => plistScopeRows(allRows, statusFilter, hierarchyFilter),
    [allRows, statusFilter, hierarchyFilter],
  );

  const visibleRows = useMemo(
    () =>
      filterPlistRows(allRows, {
        status: statusFilter,
        hierarchy: hierarchyFilter,
        localSearch,
        globalSearch,
        manager,
        selectedIds,
        selectionOnly,
      }),
    [
      allRows,
      statusFilter,
      hierarchyFilter,
      localSearch,
      globalSearch,
      manager,
      selectedIds,
      selectionOnly,
    ],
  );

  const totals = useMemo(() => {
    let contract = 0;
    let billed = 0;
    const clients = new Set<string>();
    for (const entry of visibleRows) {
      clients.add(entry.client);
      contract += entry.row.contract || 0;
      billed += entry.row.billed || 0;
    }
    return {
      clients: clients.size,
      rows: visibleRows.length,
      contract,
      billed,
    };
  }, [visibleRows]);

  const visibleIds = useMemo(() => visibleRows.map((r) => r.id), [visibleRows]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectionOnly(false);
  }

  function resetFilters() {
    setLocalSearch('');
    setStatusFilter('ACTIVE');
    setHierarchyFilter('all');
    setManager('');
    clearSelection();
  }

  return (
    <section className="sheet active plist-sheet">
      <div className="plist-toolbar">
        <div className="plist-toolbar-group">
          <label className="plist-field">
            <span className="plist-field-label">Project status</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ProjectStatusFilter)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="plist-field">
            <span className="plist-field-label">Hierarchy</span>
            <select
              value={hierarchyFilter}
              onChange={(e) => setHierarchyFilter(e.target.value as PlistHierarchyFilter)}
              title="Filter project headers vs phase rows"
            >
              {HIERARCHY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="plist-field plist-field-grow">
            <span className="plist-field-label">Search</span>
            <input
              type="search"
              placeholder="Search…"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="plist-field">
            <span className="plist-field-label">Manager</span>
            <select value={manager} onChange={(e) => setManager(e.target.value)}>
              <option value="">All</option>
              {managers.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="plist-toolbar-actions">
          <label className="plist-selection-toggle">
            <input
              type="checkbox"
              checked={selectionOnly}
              disabled={selectedIds.size === 0}
              onChange={(e) => setSelectionOnly(e.target.checked)}
            />
            Limit to selection ({selectedIds.size})
          </label>
          <button
            type="button"
            className="reset-btn"
            disabled={selectedIds.size === 0}
            onClick={clearSelection}
          >
            Clear selection
          </button>
          <button type="button" className="reset-btn" onClick={resetFilters}>
            Reset filters
          </button>
        </div>
      </div>

      <p className="plist-scope mono">
        Showing {visibleRows.length.toLocaleString()} of {scopeRows.length.toLocaleString()}{' '}
        projects and phases in view
        {globalSearch.trim() ? ' · header search active' : ''}
      </p>

      <KpiRow
        items={[
          { k: 'Clients', v: String(totals.clients) },
          { k: 'Rows', v: String(totals.rows), cls: 'accent-teal' },
          { k: 'Contract', v: fmtUSDk(totals.contract), cls: 'accent-green' },
          { k: 'Net Billed', v: fmtUSDk(totals.billed), cls: 'accent-rust' },
        ]}
      />

      <div className="panel plist-panel-fill">
        <h3>
          Project list
          <span className="tag">
            <span className="plist-kind-icon plist-kind-project" title="Project header">
              ▣
            </span>{' '}
            project ·{' '}
            <span className="plist-kind-icon plist-kind-phase" title="Phase / sub-project">
              ◦
            </span>{' '}
            phase
          </span>
        </h3>
        <div className="table-scroll plist-table-scroll">
          <table className="data plist-table">
            <thead>
              <tr>
                <th className="plist-col-check">
                  <input
                    type="checkbox"
                    aria-label="Select all visible rows"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                  />
                </th>
                <th className="plist-col-kind" title="Hierarchy level">
                  Lvl
                </th>
                <th>Name</th>
                <th>Client</th>
                <th>Manager</th>
                <th>Sts</th>
                <th className="num">Billed Hrs</th>
                <th className="num">Spent Hrs</th>
                <th className="num">Net Billed</th>
                <th className="num">Contract</th>
                <th className="num">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="plist-empty">
                    No projects or phases match the current filters.
                  </td>
                </tr>
              ) : (
                visibleRows.map((entry) => {
                  const r = entry.row;
                  const isProject = entry.kind === 'project';
                  return (
                    <tr
                      key={entry.id}
                      className={isProject ? 'plist-row-project' : 'plist-row-phase'}
                    >
                      <td className="plist-col-check">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(entry.id)}
                          aria-label={`Select ${r.project}`}
                          onChange={() => toggleRow(entry.id)}
                        />
                      </td>
                      <td className="plist-col-kind">
                        <span
                          className={`plist-kind-icon ${isProject ? 'plist-kind-project' : 'plist-kind-phase'}`}
                          title={isProject ? 'Project header' : 'Phase / sub-project'}
                          aria-hidden="true"
                        >
                          {isProject ? '▣' : '◦'}
                        </span>
                      </td>
                      <td className="plist-name-cell">
                        <span className={isProject ? 'plist-name-project' : 'plist-name-phase'}>
                          {isProject ? entry.title : entry.phaseLabel || r.project}
                        </span>
                        {entry.code ? (
                          <span className="plist-code mono">{entry.code}</span>
                        ) : null}
                        {!isProject ? (
                          <span className="plist-phase-parent mono">{entry.title}</span>
                        ) : null}
                      </td>
                      <td>{entry.client}</td>
                      <td>{r.manager || '—'}</td>
                      <td className="mono">{statusAbbrev(r.status || 'ACTIVE')}</td>
                      <td className="num">{(r.billed_hours ?? 0).toFixed(2)}</td>
                      <td className="num">{(r.spent_hours ?? 0).toFixed(2)}</td>
                      <td className="num">{fmtUSD(r.billed || 0)}</td>
                      <td className="num">{fmtUSD(r.contract || 0)}</td>
                      <td className="num">{fmtUSD(rowOutstanding(r))}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
