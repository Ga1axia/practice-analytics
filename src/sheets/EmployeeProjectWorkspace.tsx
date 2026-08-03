import { useEffect, useMemo, useState } from 'react';
import { ClientMeetingsPanel } from '../components/ClientMeetingsPanel';
import { ClientMessageThread } from '../components/ClientMessageThread';
import { PlanSetsPanel } from '../components/PlanSetsPanel';
import { ScheduleDeadlineCalendar } from '../components/ScheduleDeadlineCalendar';
import { useAuth } from '../hooks/useAuth';
import { processPhaseLabel } from '../lib/architecturalProcess';
import { buildDemoProjectDetail } from '../lib/demoProjectDetail';
import { fmtUSD } from '../lib/format';
import { loadProjectSchedule, scheduleDeliverables } from '../lib/loadProjectSchedule';
import type { ProjectNode } from '../lib/projectListHierarchy';
import { rowOutstanding } from '../lib/receivable';
import { buildDeadlineEvents } from '../lib/scheduleDates';
import { groupScheduleSections, statusTone } from '../lib/scheduleSections';
import type { ScheduleRow } from '../lib/scheduleTypes';

type Props = {
  project: ProjectNode & { clientName: string };
  employeeName: string;
};

export function EmployeeProjectWorkspace({ project, employeeName }: Props) {
  const { profile } = useAuth();
  const [dbRows, setDbRows] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const detailRows = useMemo(() => {
    if (project.phases.length) return project.phases.map((p) => p.row);
    return project.row ? [project.row] : [];
  }, [project]);

  const header = project.row || detailRows[0] || null;
  const manager = header?.manager || detailRows.find((r) => r.manager)?.manager || employeeName;
  const status = header?.status || detailRows.find((r) => r.status)?.status || null;
  const phaseRaw = header?.phase || detailRows.find((r) => r.phase)?.phase || null;
  const city = header?.city || detailRows.find((r) => r.city)?.city || null;
  const outstanding = project.outstanding ?? detailRows.reduce((a, r) => a + rowOutstanding(r), 0);

  const demo = useMemo(
    () => buildDemoProjectDetail(project.key, project.clientName, manager),
    [project.key, project.clientName, manager],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { rows: loaded } = await loadProjectSchedule(project.key);
      if (cancelled) return;
      setDbRows(loaded);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [project.key]);

  const usingDemo = !loading && dbRows.length === 0;
  const rows = usingDemo ? demo.rows : dbRows;

  const boardProject = {
    projectKey: project.key,
    title: project.title,
    clientName: project.clientName,
    manager,
    status,
    city,
    phase: phaseRaw,
  };

  const authorName =
    profile?.employee_name || profile?.display_name || employeeName || 'Project manager';

  const sectionMap = useMemo(() => {
    const sections = groupScheduleSections(rows);
    const map = new Map<string, string>();
    for (const s of sections) {
      for (const item of s.items) map.set(item.id, s.title);
      if (s.phaseRow) map.set(s.phaseRow.id, s.title);
    }
    return map;
  }, [rows]);

  const events = useMemo(
    () => buildDeadlineEvents(rows, sectionMap).filter((e) => e.kind !== 'phase'),
    [rows, sectionMap],
  );

  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  }, []);

  const overdue = useMemo(
    () =>
      events.filter((e) => e.date.getTime() < today && !/completed|n\/a/i.test(e.status)).length,
    [events, today],
  );

  const deliverables = useMemo(() => scheduleDeliverables(rows).slice(0, 8), [rows]);

  const noteThreads = useMemo(() => {
    const sections = groupScheduleSections(rows);
    const out: { section: string; task: string; firm: string; client: string }[] = [];
    for (const s of sections) {
      for (const r of s.items) {
        if (!r.mdesigns_comments.trim() && !r.client_comments.trim()) continue;
        out.push({
          section: s.title,
          task: r.task || 'Untitled',
          firm: r.mdesigns_comments.trim(),
          client: r.client_comments.trim(),
        });
      }
    }
    return out.slice(0, 4);
  }, [rows]);

  return (
    <div className="emp-project" id="emp-project-page">
      <header className="emp-project-hero">
        <div>
          <p className="pd-kicker">
            Project detail
            {usingDemo ? <span className="emp-demo-tag"> · Demo seed</span> : null}
          </p>
          <h1 className="display">{project.title}</h1>
          <p className="pd-hero-meta">
            <span>{project.clientName}</span>
            <span className="dot">·</span>
            <span>{processPhaseLabel(phaseRaw)}</span>
            {city ? (
              <>
                <span className="dot">·</span>
                <span>{city}</span>
              </>
            ) : null}
            {status ? (
              <>
                <span className="dot">·</span>
                <span className={`badge ${(status || '').toLowerCase()}`}>{status}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="emp-project-stats mono">
          <span>Contract {fmtUSD(project.contract)}</span>
          <span>Outstanding {fmtUSD(Math.max(0, outstanding))}</span>
          <span>
            {events.length} dated
            {overdue ? ` · ${overdue} past due` : ''}
          </span>
        </div>
      </header>

      <section className="panel emp-detail-cal">
        <h3>
          Project calendar{' '}
          <span className="tag">
            {events.length} dated{overdue ? ` · ${overdue} past due` : ''}
          </span>
        </h3>
        <ScheduleDeadlineCalendar
          projectKey={project.key}
          corner={false}
          layout="split"
          rowsOverride={usingDemo ? demo.rows : null}
        />
      </section>

      <div className="emp-detail-pair">
        <section className="panel">
          <PlanSetsPanel projectKey={project.key} projectTitle={project.title} compact />
          <h3 style={{ marginTop: 18 }}>
            Schedule deliverables <span className="tag">{deliverables.length}</span>
          </h3>
          {!deliverables.length ? (
            <p className="pd-muted">No deliverables on the schedule yet.</p>
          ) : (
            <ul className="emp-doc-mini">
              {deliverables.map((d) => (
                <li key={d.id}>
                  <div>
                    <strong>{d.task}</strong>
                    <span className="mono">
                      {d.section}
                      {d.isDocument ? ' · document' : ''}
                    </span>
                  </div>
                  <span className={`emp-status-pill ${statusTone(d.status)}`}>
                    {d.status === '—' ? d.targetEnd : d.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel pd-meetings-panel">
          <ClientMeetingsPanel
            projectKey={project.key}
            clientName={project.clientName}
            compact
            seedMeetings={demo.meetings}
          />
        </section>
      </div>

      <section className="panel">
        <h3>
          Client communications{' '}
          <span className="tag">{noteThreads.length} schedule notes</span>
        </h3>
        <div className="emp-comms-wide">
          <ClientMessageThread
            project={boardProject}
            mode="pm"
            authorName={authorName}
            seedMessages={demo.messages}
          />
          {noteThreads.length ? (
            <ul className="emp-note-mini">
              {noteThreads.map((n) => (
                <li key={`${n.section}-${n.task}`}>
                  <span className="mono">{n.section}</span>
                  <strong>{n.task}</strong>
                  {n.firm ? <p className="firm">{n.firm}</p> : null}
                  {n.client ? <p className="client">{n.client}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>
    </div>
  );
}
