import { useMemo, useState } from 'react';
import { KpiRow } from '../components/KpiRow';
import { fmtUSD, fmtUSDk } from '../lib/format';
import {
  buildClientHierarchy,
  type ClientNode,
  type ProjectNode,
} from '../lib/projectListHierarchy';
import { rowOutstanding } from '../lib/receivable';
import type { DashboardData, ProjectRow } from '../lib/types';

function PhaseTable({ phases }: { phases: { row: ProjectRow; label: string }[] }) {
  if (!phases.length) {
    return <div className="plist-empty">No phases for this project.</div>;
  }
  return (
    <div className="table-scroll plist-phase-scroll">
      <table className="data">
        <thead>
          <tr>
            <th>Phase / Task</th>
            <th>Manager</th>
            <th className="num">Billed Hrs</th>
            <th className="num">Spent Hrs</th>
            <th className="num">Net Billed</th>
            <th className="num">Contract</th>
            <th className="num">Outstanding</th>
          </tr>
        </thead>
        <tbody>
          {phases.map(({ row, label }) => (
            <tr key={row.project}>
              <td title={row.project}>{label}</td>
              <td>{row.manager || '—'}</td>
              <td className="num">{(row.billed_hours ?? 0).toFixed(2)}</td>
              <td className="num">{(row.spent_hours ?? 0).toFixed(2)}</td>
              <td className="num">{fmtUSD(row.billed || 0)}</td>
              <td className="num">{fmtUSD(row.contract || 0)}</td>
              <td className="num">{fmtUSD(rowOutstanding(row))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectBlock({
  project,
  open,
  onToggle,
  showHeader,
}: {
  project: ProjectNode;
  open: boolean;
  onToggle: () => void;
  showHeader: boolean;
}) {
  if (!showHeader) {
    return <PhaseTable phases={project.phases} />;
  }

  return (
    <div className={`plist-project ${open ? 'open' : ''}`}>
      <button type="button" className="plist-project-head" onClick={onToggle}>
        <span className="plist-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="plist-project-title">
          {project.title}
          {project.code ? <span className="plist-code mono">{project.code}</span> : null}
        </span>
        <span className="plist-meta mono">
          {project.phases.length} phase{project.phases.length === 1 ? '' : 's'}
        </span>
        <span className="plist-amt mono">{fmtUSDk(project.contract)}</span>
      </button>
      {open ? <PhaseTable phases={project.phases} /> : null}
    </div>
  );
}

function ClientBlock({
  node,
  open,
  onToggle,
  openProjects,
  toggleProject,
}: {
  node: ClientNode;
  open: boolean;
  onToggle: () => void;
  openProjects: Set<string>;
  toggleProject: (key: string) => void;
}) {
  return (
    <div className={`plist-client ${open ? 'open' : ''}`}>
      <button type="button" className="plist-client-head" onClick={onToggle}>
        <span className="plist-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="plist-client-name">{node.client}</span>
        <span className="plist-meta mono">
          {node.singleProject
            ? `${node.phaseCount} phase${node.phaseCount === 1 ? '' : 's'}`
            : `${node.projects.length} projects · ${node.phaseCount} phases`}
        </span>
        <span className="plist-amt mono">{fmtUSDk(node.contract)}</span>
      </button>
      {open ? (
        <div className="plist-client-body">
          {node.singleProject ? (
            <ProjectBlock
              project={node.projects[0]!}
              open
              onToggle={() => undefined}
              showHeader={false}
            />
          ) : (
            node.projects.map((p) => (
              <ProjectBlock
                key={p.key}
                project={p}
                open={openProjects.has(p.key)}
                onToggle={() => toggleProject(p.key)}
                showHeader
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ProjectList({ data }: { data: DashboardData }) {
  const [search, setSearch] = useState('');
  const [manager, setManager] = useState('');
  const [openClients, setOpenClients] = useState<Set<string>>(new Set());
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set());

  const hierarchy = useMemo(() => buildClientHierarchy(data.projects), [data.projects]);

  const managers = useMemo(() => {
    const set = new Set<string>();
    data.projects.forEach((p) => {
      if (p.manager) set.add(p.manager);
    });
    return [...set].sort();
  }, [data.projects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return hierarchy.filter((c) => {
      if (manager) {
        const hasMgr = c.projects.some(
          (p) =>
            p.row?.manager === manager ||
            p.phases.some((ph) => ph.row.manager === manager),
        );
        if (!hasMgr) return false;
      }
      if (!q) return true;
      if (c.client.toLowerCase().includes(q)) return true;
      return c.projects.some(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.key.toLowerCase().includes(q) ||
          p.phases.some(
            (ph) =>
              ph.label.toLowerCase().includes(q) ||
              ph.row.project.toLowerCase().includes(q),
          ),
      );
    });
  }, [hierarchy, search, manager]);

  const totals = useMemo(() => {
    const clients = filtered.length;
    const projects = filtered.reduce((a, c) => a + c.projects.length, 0);
    const phases = filtered.reduce((a, c) => a + c.phaseCount, 0);
    const contract = filtered.reduce((a, c) => a + c.contract, 0);
    const billed = filtered.reduce((a, c) => a + c.billed, 0);
    return { clients, projects, phases, contract, billed };
  }, [filtered]);

  function toggleClient(client: string) {
    setOpenClients((prev) => {
      const next = new Set(prev);
      if (next.has(client)) next.delete(client);
      else next.add(client);
      return next;
    });
  }

  function toggleProject(key: string) {
    setOpenProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandAll() {
    setOpenClients(new Set(filtered.map((c) => c.client)));
    const keys = new Set<string>();
    filtered.forEach((c) => {
      if (!c.singleProject) c.projects.forEach((p) => keys.add(p.key));
    });
    setOpenProjects(keys);
  }

  function collapseAll() {
    setOpenClients(new Set());
    setOpenProjects(new Set());
  }

  return (
    <section className="sheet active">
      <div className="filters">
        <span className="f-label">Filter</span>
        <input
          type="text"
          placeholder="Search client, project, or phase…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={manager} onChange={(e) => setManager(e.target.value)}>
          <option value="">All managers</option>
          {managers.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button type="button" className="reset-btn" onClick={expandAll}>
          Expand all
        </button>
        <button type="button" className="reset-btn" onClick={collapseAll}>
          Collapse all
        </button>
        <button
          type="button"
          className="reset-btn"
          onClick={() => {
            setSearch('');
            setManager('');
          }}
        >
          Reset
        </button>
      </div>

      <KpiRow
        items={[
          { k: 'Clients', v: String(totals.clients) },
          { k: 'Projects', v: String(totals.projects), cls: 'accent-teal' },
          { k: 'Phases', v: String(totals.phases), cls: 'accent-gold' },
          { k: 'Contract', v: fmtUSDk(totals.contract), cls: 'accent-green' },
          { k: 'Net Billed', v: fmtUSDk(totals.billed), cls: 'accent-rust' },
        ]}
      />

      <div className="panel">
        <h3>
          Projects by client
          <span className="tag">
            Click a client to expand phases
            {filtered.some((c) => !c.singleProject)
              ? ' · multi-project clients show projects first'
              : ''}
          </span>
        </h3>
        <div className="plist-tree">
          {filtered.length === 0 ? (
            <div className="plist-empty">No clients match the current filters.</div>
          ) : (
            filtered.map((c) => (
              <ClientBlock
                key={c.client}
                node={c}
                open={openClients.has(c.client)}
                onToggle={() => toggleClient(c.client)}
                openProjects={openProjects}
                toggleProject={toggleProject}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}
