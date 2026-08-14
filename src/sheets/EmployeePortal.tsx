import { useEffect, useMemo, useState } from 'react';
import { EfficiencyLineChart, StackedHoursChart } from '../components/Charts';
import { EmployeeTimecard } from '../components/EmployeeTimecard';
import { KpiRow } from '../components/KpiRow';
import { ProjectSchedulePulse } from '../components/ProjectSchedulePulse';
import { processPhaseLabel } from '../lib/architecturalProcess';
import { fmtPct, fmtUSD, monthLabel } from '../lib/format';
import {
  ensureMyMembershipsFromTimeEntries,
  isProjectLead,
  isProjectListManager,
  loadMembershipsForEmployee,
  staffNameOptions,
  type ProjectMemberRole,
} from '../lib/projectMembers';
import { buildClientHierarchy, type ProjectNode } from '../lib/projectListHierarchy';
import { rowOutstanding } from '../lib/receivable';
import type { DashboardData } from '../lib/types';
import { EmployeeCalendar } from './EmployeeCalendar';
import { EmployeeProjectWorkspace } from './EmployeeProjectWorkspace';
import { EmployeeTasks } from './EmployeeTasks';

type PageId = 'hours' | 'projects' | 'tasks' | 'calendar' | 'project';
type StatusFilter = 'active' | 'all';

function projectStatus(p: ProjectNode): string {
  return (
    p.row?.status ||
    p.phases.find((ph) => ph.row.status)?.row.status ||
    'ACTIVE'
  );
}

function projectIsActive(p: ProjectNode): boolean {
  if ((p.row?.status || '').toUpperCase() === 'ACTIVE') return true;
  if (p.phases.some((ph) => (ph.row.status || '').toUpperCase() === 'ACTIVE')) return true;
  // Missing status on header + phases → treat as active (same as Project List defaults)
  if (!p.row?.status && !p.phases.some((ph) => ph.row.status)) return true;
  return false;
}

export function EmployeePortal({
  data,
  employeeName,
}: {
  data: DashboardData;
  employeeName: string;
}) {
  const [page, setPage] = useState<PageId>('hours');
  const [visited, setVisited] = useState<Set<PageId>>(() => new Set(['hours']));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [memberRoles, setMemberRoles] = useState<Map<string, ProjectMemberRole>>(
    () => new Map(),
  );

  function go(next: PageId) {
    setVisited((prev) => {
      if (prev.has(next)) return prev;
      const copy = new Set(prev);
      copy.add(next);
      return copy;
    });
    setPage(next);
  }

  const totals = useMemo(
    () => data.emp_totals.find((e) => e.employee === employeeName) || null,
    [data.emp_totals, employeeName],
  );

  const monthly = useMemo(
    () =>
      data.emp_monthly
        .filter((m) => m.employee === employeeName)
        .sort((a, b) => a.month.localeCompare(b.month)),
    [data.emp_monthly, employeeName],
  );

  const trailing = monthly.slice(-12);
  const hierarchy = useMemo(() => buildClientHierarchy(data.projects), [data.projects]);

  useEffect(() => {
    let cancelled = false;
    const projects = hierarchy.flatMap((c) =>
      c.projects.map((p) => ({ key: p.key, title: p.title, code: p.code })),
    );
    void (async () => {
      // Claim projects this employee has logged hours on, then refresh memberships.
      await ensureMyMembershipsFromTimeEntries({ employeeName, projects });
      if (cancelled) return;
      const res = await loadMembershipsForEmployee(employeeName);
      if (cancelled) return;
      setMemberRoles(res.byKey);
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeName, hierarchy]);

  const rosterNames = useMemo(
    () =>
      staffNameOptions({
        managers: data.managers,
        employeeRoster: data.employee_roster,
        extras: [employeeName],
      }),
    [data.managers, data.employee_roster, employeeName],
  );

  const allProjects = useMemo(() => {
    return hierarchy
      .flatMap((c) =>
        c.projects
          .filter(
            (p) => isProjectListManager(p, employeeName) || memberRoles.has(p.key),
          )
          .map((p) => ({ ...p, clientName: c.client })),
      )
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  }, [hierarchy, employeeName, memberRoles]);

  const activeProjects = useMemo(
    () => allProjects.filter(projectIsActive),
    [allProjects],
  );

  const filteredProjects = useMemo(() => {
    const base = statusFilter === 'active' ? activeProjects : allProjects;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.clientName.toLowerCase().includes(q) ||
        (p.code || '').toLowerCase().includes(q),
    );
  }, [statusFilter, activeProjects, allProjects, query]);

  const selectedProject = useMemo(() => {
    if (!selectedKey) return null;
    return allProjects.find((p) => p.key === selectedKey) || null;
  }, [allProjects, selectedKey]);

  const bookSource = statusFilter === 'active' ? activeProjects : allProjects;
  const leadBookSource = useMemo(
    () =>
      bookSource.filter((p) =>
        isProjectLead(p, employeeName, memberRoles.get(p.key) || null),
      ),
    [bookSource, employeeName, memberRoles],
  );
  const bookContract = leadBookSource.reduce((a, p) => a + p.contract, 0);
  const bookBilled = leadBookSource.reduce((a, p) => a + p.billed, 0);
  const bookOut = leadBookSource.reduce((a, p) => a + Math.max(0, p.outstanding), 0);
  const clientCount = new Set(bookSource.map((p) => p.clientName)).size;
  const showPaymentBook = leadBookSource.length > 0;

  function goProjects() {
    go('projects');
  }

  function selectProject(key: string) {
    setSelectedKey(key);
    go('project');
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.getElementById('emp-project-page')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function onPickFromSelect(key: string) {
    if (!key) return;
    selectProject(key);
  }

  useEffect(() => {
    function openCalendar() {
      go('calendar');
    }
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        openCalendar();
      }
    }
    window.addEventListener('pa-emp-open-calendar', openCalendar);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pa-emp-open-calendar', openCalendar);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div className="emp-portal">
      <nav className="sheets emp-sheets" aria-label="Employee pages">
        <button
          type="button"
          className={page === 'hours' ? 'active' : ''}
          onClick={() => go('hours')}
        >
          <span className="num">01</span>My timecard
        </button>
        <button
          type="button"
          className={page === 'projects' ? 'active' : ''}
          onClick={goProjects}
        >
          <span className="num">02</span>My projects
        </button>
        <button
          type="button"
          className={page === 'tasks' ? 'active' : ''}
          onClick={() => go('tasks')}
        >
          <span className="num">03</span>My tasks
        </button>
        <button
          type="button"
          className={page === 'calendar' ? 'active' : ''}
          onClick={() => go('calendar')}
        >
          <span className="num">04</span>My calendar
        </button>
        <button
          type="button"
          className={page === 'project' ? 'active' : ''}
          onClick={() => {
            if (!selectedKey && activeProjects[0]) setSelectedKey(activeProjects[0].key);
            else if (!selectedKey && allProjects[0]) setSelectedKey(allProjects[0].key);
            go('project');
          }}
          disabled={!allProjects.length}
        >
          <span className="num">05</span>Project detail
        </button>
      </nav>

      <div className={page === 'hours' ? 'emp-page' : 'emp-page emp-page-hidden'} hidden={page !== 'hours'}>
        <>
          <div className="emp-hours-top">
            <header className="emp-hero emp-hero-hours">
              <div>
                <p className="pd-kicker">My timecard</p>
                <h1 className="display">{employeeName}</h1>
                <p className="emp-lede">
                  Phase mix, project load, and efficiency from your BQE time entries.
                </p>
              </div>
            </header>

            <KpiRow
              className="emp-kpi-row"
              items={[
                {
                  k: 'Billable hours',
                  v: Math.round(totals?.bill_hours || 0).toLocaleString('en-US'),
                  cls: 'accent-teal',
                },
                {
                  k: 'Efficiency',
                  v: totals ? fmtPct(totals.efficiency || 0) : '—',
                  cls: 'accent-gold',
                },
                {
                  k: 'Active projects',
                  v: String(activeProjects.length),
                },
                {
                  k: 'All assigned',
                  v: String(allProjects.length),
                },
                {
                  k: 'Non-billable',
                  v: Math.round(totals?.nb_hours || 0).toLocaleString('en-US'),
                },
                {
                  k: 'Standard hours',
                  v: Math.round(totals?.standard_hours || 0).toLocaleString('en-US'),
                },
              ]}
            />

            <EmployeeTimecard employeeName={employeeName} />
          </div>

          <div className="grid grid-2">
            <div className="panel">
              <h3>
                Monthly hours <span className="tag">last 12 months</span>
              </h3>
              {trailing.length ? (
                <div className="chart-wrap tall">
                  <StackedHoursChart
                    labels={trailing.map((m) => monthLabel(m.month))}
                    bill={trailing.map((m) => m.bill_hours || 0)}
                    nb={trailing.map((m) => m.nb_hours || 0)}
                  />
                </div>
              ) : (
                <p className="pd-muted">No monthly hours loaded for your profile yet.</p>
              )}
            </div>
            <div className="panel">
              <h3>
                Efficiency <span className="tag">billable / standard</span>
              </h3>
              {trailing.length ? (
                <div className="chart-wrap tall">
                  <EfficiencyLineChart
                    labels={trailing.map((m) => monthLabel(m.month))}
                    values={trailing.map((m) => (m.efficiency || 0) * 100)}
                  />
                </div>
              ) : (
                <p className="pd-muted">
                  Efficiency trend appears when monthly hours are available.
                </p>
              )}
            </div>
          </div>

          <div className="panel emp-quick">
            <h3>Jump to projects</h3>
            <p className="pd-muted">
              {activeProjects.length} active assignment
              {activeProjects.length === 1 ? '' : 's'}
              {allProjects.length !== activeProjects.length
                ? ` · ${allProjects.length} total assigned`
                : ''}
              .
            </p>
            <button type="button" className="emp-primary-btn" onClick={goProjects}>
              Browse my projects
            </button>
          </div>
        </>
      </div>

      <div
        className={page === 'projects' ? 'emp-page' : 'emp-page emp-page-hidden'}
        hidden={page !== 'projects'}
      >
        <>
          <header className="emp-hero emp-hero-row">
            <div>
              <p className="pd-kicker">Projects</p>
              <h1 className="display">My projects</h1>
              <p className="emp-lede">
                Open a project for its task list, calendar, meetings, and schedule.
              </p>
            </div>
            <div className="emp-filter-bar">
              <div className="emp-status-toggle" role="group" aria-label="Project status filter">
                <button
                  type="button"
                  className={statusFilter === 'active' ? 'on' : ''}
                  onClick={() => setStatusFilter('active')}
                >
                  Active ({activeProjects.length})
                </button>
                <button
                  type="button"
                  className={statusFilter === 'all' ? 'on' : ''}
                  onClick={() => setStatusFilter('all')}
                >
                  All ({allProjects.length})
                </button>
              </div>
              <label className="emp-search">
                <span className="visually-hidden">Search projects</span>
                <input
                  type="search"
                  placeholder="Search project or client…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
          </header>

          <KpiRow
            items={[
              {
                k: statusFilter === 'active' ? 'Active projects' : 'Shown projects',
                v: String(filteredProjects.length),
              },
              { k: 'Clients', v: String(clientCount) },
              ...(showPaymentBook
                ? [
                    { k: 'Contract book', v: fmtUSD(bookContract) },
                    { k: 'Billed', v: fmtUSD(bookBilled) },
                    {
                      k: 'Outstanding',
                      v: fmtUSD(bookOut),
                      cls: 'accent-rust' as const,
                    },
                  ]
                : [{ k: 'Team role', v: 'Member' }]),
            ]}
          />

          {!allProjects.length ? (
            <div className="panel">
              <p className="pd-muted">
                No projects yet. You appear here when you manage a project in the Project List,
                or a project lead adds you as a member.
              </p>
            </div>
          ) : !filteredProjects.length ? (
            <div className="panel">
              <p className="pd-muted">
                {statusFilter === 'active'
                  ? 'No active projects match. Try “All” or clear the search.'
                  : 'No projects match your search.'}
              </p>
            </div>
          ) : (
            <div className="emp-gallery" role="list">
              {filteredProjects.map((p) => {
                const status = projectStatus(p);
                const phaseRaw =
                  p.row?.phase || p.phases.find((ph) => ph.row.phase)?.row.phase || null;
                const city = p.row?.city || p.phases.find((ph) => ph.row.city)?.row.city || null;
                const myPhases = p.phases.filter((ph) => ph.row.manager === employeeName);
                const out = myPhases.length
                  ? myPhases.reduce((a, x) => a + rowOutstanding(x.row), 0)
                  : p.outstanding;
                const selected = selectedKey === p.key;
                const lead = isProjectLead(p, employeeName, memberRoles.get(p.key) || null);
                return (
                  <button
                    key={p.key}
                    type="button"
                    role="listitem"
                    className={`emp-gallery-card${selected ? ' selected' : ''}`}
                    onClick={() => selectProject(p.key)}
                  >
                    <div className="emp-gallery-top">
                      <span className={`badge ${String(status).toLowerCase()}`}>{status}</span>
                      <ProjectSchedulePulse projectKey={p.key} />
                    </div>
                    <p className="emp-gallery-client mono">{p.clientName}</p>
                    <h3 className="display emp-gallery-title">{p.title}</h3>
                    <p className="emp-gallery-meta">
                      {p.code ? <span className="mono">{p.code}</span> : null}
                      {p.code ? <span className="dot">·</span> : null}
                      <span>{processPhaseLabel(phaseRaw)}</span>
                      {city ? (
                        <>
                          <span className="dot">·</span>
                          <span>{city}</span>
                        </>
                      ) : null}
                      <>
                        <span className="dot">·</span>
                        <span>{lead ? 'Lead' : 'Member'}</span>
                      </>
                    </p>
                    <div className="emp-gallery-stats">
                      {lead ? (
                        <>
                          <div>
                            <span className="k">Contract</span>
                            <span className="v">{fmtUSD(p.contract)}</span>
                          </div>
                          <div>
                            <span className="k">Outstanding</span>
                            <span className="v">{fmtUSD(Math.max(0, out))}</span>
                          </div>
                        </>
                      ) : (
                        <div>
                          <span className="k">Access</span>
                          <span className="v">Team member</span>
                        </div>
                      )}
                      <div>
                        <span className="k">Phases</span>
                        <span className="v">{myPhases.length || p.phases.length}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      </div>

      {visited.has('tasks') ? (
        <div
          className={page === 'tasks' ? 'emp-page' : 'emp-page emp-page-hidden'}
          hidden={page !== 'tasks'}
        >
          <EmployeeTasks
            projects={activeProjects.length ? activeProjects : allProjects}
            employeeName={employeeName}
            onOpenProject={selectProject}
            active={page === 'tasks'}
          />
        </div>
      ) : null}

      {visited.has('calendar') ? (
        <div
          className={page === 'calendar' ? 'emp-page' : 'emp-page emp-page-hidden'}
          hidden={page !== 'calendar'}
        >
          <EmployeeCalendar
            projects={activeProjects.length ? activeProjects : allProjects}
            employeeName={employeeName}
            onOpenProject={selectProject}
          />
        </div>
      ) : null}

      {visited.has('project') ? (
        <div
          className={page === 'project' ? 'emp-page' : 'emp-page emp-page-hidden'}
          hidden={page !== 'project'}
        >
          <div className="emp-toolbar emp-project-picker">
            <button type="button" className="sched-text-btn" onClick={goProjects}>
              ← My projects
            </button>
            <label className="emp-pick-label">
              <span>Selected project</span>
              <select
                value={selectedProject?.key || ''}
                onChange={(e) => onPickFromSelect(e.target.value)}
              >
                <option value="" disabled>
                  Choose a project…
                </option>
                <optgroup label={`Active (${activeProjects.length})`}>
                  {activeProjects.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.title} — {p.clientName}
                    </option>
                  ))}
                </optgroup>
                {allProjects.length > activeProjects.length ? (
                  <optgroup label={`Inactive / other (${allProjects.length - activeProjects.length})`}>
                    {allProjects
                      .filter((p) => !projectIsActive(p))
                      .map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.title} — {p.clientName}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
              </select>
            </label>
          </div>

          {selectedProject ? (
            <EmployeeProjectWorkspace
              project={selectedProject}
              employeeName={employeeName}
              isLead={isProjectLead(
                selectedProject,
                employeeName,
                memberRoles.get(selectedProject.key) || null,
              )}
              rosterNames={rosterNames}
              onMembershipChange={() => {
                void loadMembershipsForEmployee(employeeName).then((res) => {
                  setMemberRoles(res.byKey);
                });
              }}
            />
          ) : (
            <div className="panel">
              <p className="pd-muted">
                Select a project from My projects, or choose one in the menu above.
              </p>
              <button type="button" className="emp-primary-btn" onClick={goProjects}>
                Browse my projects
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
