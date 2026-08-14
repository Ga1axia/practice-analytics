import { useEffect, useMemo, useState } from 'react';
import { ClientMeetingsPanel } from '../components/ClientMeetingsPanel';
import { ClientMessageThread } from '../components/ClientMessageThread';
import { KpiRow } from '../components/KpiRow';
import { ProjectMembersPanel } from '../components/ProjectMembersPanel';
import { ProjectTaskList } from '../components/ProjectTaskList';
import { ScheduleDeadlineCalendar } from '../components/ScheduleDeadlineCalendar';
import { ScheduleStartPrompt } from '../components/ScheduleStartPrompt';
import { useAuth } from '../hooks/useAuth';
import { useDemoMode } from '../hooks/useDemoMode';
import {
  matchProcessPhaseIndex,
  PROCESS_PHASES,
  processPhaseLabel,
} from '../lib/architecturalProcess';
import { buildDemoProjectDetail } from '../lib/demoProjectDetail';
import { fmtUSD } from '../lib/format';
import { scheduleDeliverables } from '../lib/loadProjectSchedule';
import type { ProjectMember } from '../lib/projectMembers';
import type { ProjectNode } from '../lib/projectListHierarchy';
import {
  loadProjectLoggedHours,
  type ProjectLoggedHours,
} from '../lib/projectLoggedHours';
import { rowOutstanding } from '../lib/receivable';
import {
  clearScheduleStartDismiss,
  dismissScheduleStartForever,
  dismissScheduleStartLater,
  getProjectStartDate,
  inferSchedulePresetKind,
  scheduleNeedsStartPrompt,
  setProjectStartDate,
  type SchedulePresetKind,
} from '../lib/scheduleAutofill';
import { buildDeadlineEvents } from '../lib/scheduleDates';
import {
  applyProjectSchedulePreset,
  ensureProjectSchedule,
  saveProjectScheduleStartDate,
} from '../lib/scheduleEnsure';
import { fromDateInputValue, toDateInputValue } from '../lib/scheduleMutations';
import { groupScheduleSections, statusTone } from '../lib/scheduleSections';
import type { ScheduleMeta, ScheduleRow } from '../lib/scheduleTypes';

const PHASE_FALLBACK_COLORS = [
  '#146C6B',
  '#3A6EA5',
  '#2F4F7A',
  '#A8783A',
  '#5B7C6E',
  '#7A5A22',
  '#4C6580',
  '#8B6B4A',
];

function phaseColor(label: string, i: number): string {
  const idx = matchProcessPhaseIndex(label);
  if (idx >= 0) return PROCESS_PHASES[idx]!.color;
  return PHASE_FALLBACK_COLORS[i % PHASE_FALLBACK_COLORS.length]!;
}

type PhaseHourSlice = { label: string; hours: number; color: string; share: number };

function PhaseHoursChart({
  slices,
  source,
}: {
  slices: PhaseHourSlice[];
  source: string;
}) {
  if (!slices.length) return null;
  const total = slices.reduce((a, s) => a + s.hours, 0);
  return (
    <section className="panel emp-phase-hours">
      <h3>
        Hours by phase <span className="tag">{source}</span>
      </h3>
      <div
        className="emp-phase-stack"
        role="img"
        aria-label={`Hours by phase totaling ${total.toFixed(0)}`}
      >
        {slices.map((s, i) => (
          <div
            key={`${s.label}-${i}`}
            className="emp-phase-stack-seg"
            style={{ width: `${Math.max(s.share * 100, 0.8)}%`, background: s.color }}
            title={`${s.label}: ${s.hours.toFixed(1)}h (${Math.round(s.share * 100)}%)`}
          />
        ))}
      </div>
      <ul className="emp-phase-stack-legend">
        {slices.map((s, i) => (
          <li key={`${s.label}-${i}`}>
            <i style={{ background: s.color }} />
            <span className="lab">{s.label}</span>
            <span className="mono">
              {s.hours.toFixed(0)}h · {Math.round(s.share * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Props = {
  project: ProjectNode & { clientName: string };
  employeeName: string;
  isLead?: boolean;
  rosterNames?: string[];
  onMembershipChange?: () => void;
};

export function EmployeeProjectWorkspace({
  project,
  employeeName,
  isLead = true,
  rosterNames = [],
  onMembershipChange,
}: Props) {
  const isDemo = useDemoMode();
  const { profile } = useAuth();
  const [dbRows, setDbRows] = useState<ScheduleRow[]>([]);
  const [scheduleMeta, setScheduleMeta] = useState<ScheduleMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState<ProjectLoggedHours | null>(null);
  const [hoursLoading, setHoursLoading] = useState(true);
  const [showStartPrompt, setShowStartPrompt] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [startDateText, setStartDateText] = useState('');
  const [teamMembers, setTeamMembers] = useState<ProjectMember[]>([]);
  const showPayments = isLead;

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
    () =>
      isDemo ? buildDemoProjectDetail(project.key, project.clientName, manager) : null,
    [isDemo, project.key, project.clientName, manager],
  );

  const defaultPreset = useMemo(
    () => inferSchedulePresetKind(project.title, project.row?.type),
    [project.title, project.row?.type],
  );

  const leadNames = useMemo(
    () =>
      [
        ...new Set(
          [project.row?.manager, ...project.phases.map((ph) => ph.row.manager)]
            .map((n) => (n || '').trim())
            .filter(Boolean),
        ),
      ],
    [project.row?.manager, project.phases],
  );

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      // Don't leave the page stuck on "Checking…" if Supabase hangs.
      setLoading((prev) => {
        if (!prev) return prev;
        setShowStartPrompt(true);
        setStartError((e) => e || 'Schedule check timed out — you can still start a schedule.');
        return false;
      });
    }, 8000);

    (async () => {
      setLoading(true);
      setStartError(null);
      setShowStartPrompt(false);
      try {
        const ensured = await ensureProjectSchedule({
          projectKey: project.key,
          clientName: project.clientName,
          title: project.title,
          autoSeed: false,
          autoDate: false,
          forceRefresh: true,
        });
        if (cancelled) return;
        setDbRows(ensured.rows);
        setScheduleMeta(ensured.meta);
        const savedStart =
          (ensured.meta?.start_date || '').trim() || getProjectStartDate(project.key);
        setStartDateText(savedStart ? toDateInputValue(savedStart) : toDateInputValue(new Date()));
        const needs = scheduleNeedsStartPrompt(ensured.rows);
        if (needs) clearScheduleStartDismiss(project.key);
        setShowStartPrompt(needs);
        if (ensured.error) setStartError(ensured.error);
      } catch (e) {
        if (cancelled) return;
        setDbRows([]);
        setScheduleMeta(null);
        setShowStartPrompt(true);
        setStartError(e instanceof Error ? e.message : 'Could not load schedule');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [project.key, project.clientName, project.title]);

  async function onStartSchedule(input: { kickoff: Date; preset: SchedulePresetKind }) {
    setStartBusy(true);
    setStartError(null);
    setShowStartPrompt(true);
    try {
      const res = await applyProjectSchedulePreset({
        projectKey: project.key,
        clientName: project.clientName,
        title: project.title,
        kickoff: input.kickoff,
        preset: input.preset,
      });
      const taskCount = res.rows.filter(
        (r) =>
          (r.row_kind === 'task' || r.row_kind === 'subtask') && Boolean((r.task || '').trim()),
      ).length;
      if (!taskCount) {
        const msg =
          res.error ||
          'Schedule was not created (no checklist tasks). Try again or check staff schedule permissions.';
        console.error('[schedule start]', msg, res);
        setStartError(msg);
        setShowStartPrompt(true);
        setDbRows(res.rows);
        setScheduleMeta(res.meta);
        return;
      }
      if (res.error) {
        console.warn('[schedule start partial]', res.error);
        setStartError(res.error);
      } else {
        setStartError(null);
      }
      setDbRows(res.rows);
      setScheduleMeta(res.meta);
      const saved = (res.meta?.start_date || '').trim() || getProjectStartDate(project.key);
      setStartDateText(saved ? toDateInputValue(saved) : toDateInputValue(input.kickoff));
      setShowStartPrompt(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not start schedule';
      console.error('[schedule start]', e);
      setStartError(msg);
      setShowStartPrompt(true);
    } finally {
      setStartBusy(false);
    }
  }

  async function onCommitStartDate(ymd: string) {
    const scheduleText = ymd ? fromDateInputValue(ymd) : '';
    setStartDateText(ymd);
    if (!scheduleText) return;
    setProjectStartDate(project.key, scheduleText);
    await saveProjectScheduleStartDate({
      projectKey: project.key,
      scheduleId: scheduleMeta?.id,
      startDate: scheduleText,
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHoursLoading(true);
      const res = await loadProjectLoggedHours({
        employeeName,
        projectTitle: project.title,
        projectFullName: project.row?.project || project.key,
        projectCode: project.code,
        clientName: project.clientName,
      });
      if (cancelled) return;
      setHours(res);
      setHoursLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeName, project.title, project.row?.project, project.key, project.code, project.clientName]);

  // Never mask an empty/undated live schedule with demo rows — the start prompt must show.
  const needsSchedule = !loading && scheduleNeedsStartPrompt(dbRows);
  const usingDemo = Boolean(isDemo && demo && !loading && !needsSchedule && dbRows.length === 0);
  const rows = usingDemo && demo ? demo.rows : dbRows;

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

  /** Prefer Project List spent hours by phase; fall back to this employee's TE mix. */
  const phaseHourSlices = useMemo((): { slices: PhaseHourSlice[]; source: string } => {
    const fromList = project.phases
      .map((ph) => ({
        label: processPhaseLabel(ph.label || ph.row.phase) || ph.label || 'Phase',
        hours: Number(ph.row.spent_hours) || 0,
      }))
      .filter((s) => s.hours > 0);
    const listTotal = fromList.reduce((a, s) => a + s.hours, 0);
    if (listTotal > 0) {
      return {
        source: 'Project spent',
        slices: fromList
          .sort((a, b) => b.hours - a.hours)
          .map((s, i) => ({
            ...s,
            share: s.hours / listTotal,
            color: phaseColor(s.label, i),
          })),
      };
    }
    const fromTe = hours?.byPhase || [];
    const teTotal = fromTe.reduce((a, s) => a + s.hours, 0);
    if (teTotal > 0) {
      return {
        source: 'Your logged hours',
        slices: fromTe.map((s, i) => ({
          label: processPhaseLabel(s.label) || s.label,
          hours: s.hours,
          share: s.hours / teTotal,
          color: phaseColor(s.label, i),
        })),
      };
    }
    return { slices: [], source: '' };
  }, [project.phases, hours]);

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
          <label className="emp-project-start-date">
            <span>Project start date</span>
            <input
              type="date"
              className="emp-date-input"
              value={startDateText}
              disabled={loading || startBusy}
              onChange={(e) => void onCommitStartDate(e.target.value)}
              title="Autofilled deadlines cascade from this date"
            />
          </label>
        </div>
        <aside className="emp-project-hero-aside">
          <div className="emp-project-stats mono">
            {showPayments ? (
              <>
                <span>Contract {fmtUSD(project.contract)}</span>
                <span>Outstanding {fmtUSD(Math.max(0, outstanding))}</span>
              </>
            ) : (
              <span>Team member</span>
            )}
            <span>
              {events.length} dated
              {overdue ? ` · ${overdue} past due` : ''}
            </span>
          </div>
          <ProjectMembersPanel
            compact
            projectKey={project.key}
            projectTitle={project.title}
            projectCode={project.code}
            leadNames={leadNames}
            employeeName={employeeName}
            canManage={isLead && !usingDemo}
            rosterNames={rosterNames}
            onMembersChange={(members) => {
              setTeamMembers(members);
              onMembershipChange?.();
            }}
          />
        </aside>
      </header>

      {loading ? (
        <section className="panel emp-sched-start emp-sched-start-compact">
          <h3>Checking project schedule…</h3>
          <p className="pd-muted">Looking for an assigned checklist and deadlines.</p>
        </section>
      ) : needsSchedule && showStartPrompt ? (
        <ScheduleStartPrompt
          key={`${project.key}-start`}
          projectKey={project.key}
          projectTitle={project.title}
          defaultPreset={defaultPreset}
          busy={startBusy}
          error={startError}
          onYes={(input) => void onStartSchedule(input)}
          onMaybeLater={() => {
            dismissScheduleStartLater(project.key);
            setShowStartPrompt(false);
          }}
          onDontShowAgain={() => {
            dismissScheduleStartForever(project.key);
            setShowStartPrompt(false);
          }}
        />
      ) : needsSchedule ? (
        <section className="panel emp-sched-start emp-sched-start-compact">
          <h3>No project schedule assigned</h3>
          <p className="pd-muted">
            This project has no checklist tasks yet.
            {startError ? ` (${startError})` : ''}
          </p>
          <div className="emp-sched-start-actions">
            <button
              type="button"
              className="emp-primary-btn"
              onClick={() => {
                clearScheduleStartDismiss(project.key);
                setShowStartPrompt(true);
              }}
            >
              Start schedule
            </button>
          </div>
        </section>
      ) : null}

      <KpiRow
        items={[
          {
            k: 'Your hours',
            v: hoursLoading ? '…' : (hours?.yourHours ?? 0).toFixed(1),
            cls: 'accent-teal',
          },
          {
            k: 'Your billable',
            v: hoursLoading ? '…' : (hours?.yourBillable ?? 0).toFixed(1),
            cls: 'accent-gold',
          },
          {
            k: 'Project spent h',
            v: project.spentHours
              ? project.spentHours.toLocaleString('en-US', { maximumFractionDigits: 0 })
              : '—',
          },
          {
            k: 'Project billed h',
            v: project.billedHours
              ? project.billedHours.toLocaleString('en-US', { maximumFractionDigits: 0 })
              : '—',
          },
          {
            k: 'Your entries',
            v: hoursLoading ? '…' : String(hours?.entries ?? 0),
          },
          ...(showPayments
            ? [
                {
                  k: 'Contract',
                  v: fmtUSD(project.contract),
                },
              ]
            : [
                {
                  k: 'Role',
                  v: 'Member',
                },
              ]),
        ]}
      />
      {hours?.error ? (
        <p className="plist-upload-err" style={{ marginTop: -8 }}>
          {hours.error}
        </p>
      ) : null}

      {phaseHourSlices.slices.length ? (
        <PhaseHoursChart slices={phaseHourSlices.slices} source={phaseHourSlices.source} />
      ) : !hoursLoading ? (
        <p className="pd-muted emp-project-hours-mix">
          No phase hour breakdown available for this project yet.
        </p>
      ) : null}

      <div className="emp-project-main">
        <section className="panel emp-detail-cal">
          <h3>
            Project calendar{' '}
            <span className="tag">
              {events.length} dated{overdue ? ` · ${overdue} past due` : ''}
            </span>
          </h3>
          {!loading && !rows.length ? (
            <p className="pd-muted">No schedule dates for this project yet.</p>
          ) : (
            <ScheduleDeadlineCalendar
              projectKey={project.key}
              corner={false}
              layout="calendar"
              rowsOverride={rows.length ? rows : null}
            />
          )}
        </section>

        <aside className="panel emp-project-tasks-panel">
          <h3>
            Task list{' '}
            <span className="tag">
              {loading ? '…' : `${rows.filter((r) => r.row_kind !== 'phase').length}`}
            </span>
          </h3>
          {loading ? (
            <p className="pd-muted">Loading tasks…</p>
          ) : (
            <ProjectTaskList
              projectKey={project.key}
              projectTitle={project.title}
              clientName={project.clientName}
              employeeName={employeeName}
              rows={rows}
              writable={!usingDemo}
              canAssign={isLead && !usingDemo}
              assigneeOptions={teamMembers.map((m) => m.employee_name)}
              onRowsChange={setDbRows}
              onStartSchedule={
                needsSchedule
                  ? () => {
                      clearScheduleStartDismiss(project.key);
                      setShowStartPrompt(true);
                      document
                        .getElementById('emp-sched-start-title')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  : undefined
              }
            />
          )}
        </aside>
      </div>

      <div className="emp-detail-pair">
        <section className="panel">
          <h3>
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
            seedMeetings={usingDemo && demo ? demo.meetings : null}
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
            seedMessages={usingDemo && demo ? demo.messages : null}
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
