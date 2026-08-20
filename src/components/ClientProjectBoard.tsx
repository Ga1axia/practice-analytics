import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PROCESS_PHASES,
  matchProcessPhaseIndex,
  processPhaseLabel,
  type ProcessPhaseId,
} from '../lib/architecturalProcess';
import type {
  ClientBoardMode,
  ClientBoardOption,
  ClientBoardProject,
  ClientMessage,
} from '../lib/clientBoardTypes';
import {
  clientNeedKind,
  displayPersonName,
  displayTaskTitle,
  glossaryTitle,
  staffContact,
} from '../lib/clientCopy';
import {
  clientDeliverables,
  dismissAlert,
  documentReviews,
  inferCurrentPhase,
  isAlertDismissed,
  mainStageCount,
  markDocumentReviewed,
  markPortalSeen,
  milestoneHealth,
  needsClientReply,
  phaseEndFromRows,
  portalSeenAt,
  stageProgressPct,
  type ClientAlert,
} from '../lib/clientPortal';
import { downloadKvPdf, downloadTablePdf } from '../lib/downloadPdf';
import { fmtUSD } from '../lib/format';
import { buildDeadlineEvents, startOfDay } from '../lib/scheduleDates';
import { groupScheduleSections, sectionStatus } from '../lib/scheduleSections';
import type { ScheduleRow } from '../lib/scheduleTypes';
import { supabase } from '../lib/supabase';
import { ClientMeetingsPanel } from './ClientMeetingsPanel';
import { ClientMessageThread } from './ClientMessageThread';
import { CustomerComms } from './CustomerComms';
import { ScheduleDeadlineCalendar } from './ScheduleDeadlineCalendar';

type CenterTab = 'overview' | 'documents' | 'budget' | 'notes';

function stageState(i: number, currentIdx: number): 'done' | 'current' | 'upcoming' {
  if (currentIdx < 0) return 'upcoming';
  if (PROCESS_PHASES[currentIdx]?.id === 'additional') {
    return PROCESS_PHASES[i]?.id === 'additional' ? 'current' : i < currentIdx ? 'done' : 'upcoming';
  }
  if (i < currentIdx) return 'done';
  if (i === currentIdx) return 'current';
  return 'upcoming';
}

function Glossed({ text }: { text: string }) {
  const tip = glossaryTitle(text);
  if (!tip) return <>{text}</>;
  return (
    <span className="cp-glossary" title={tip}>
      {text}
    </span>
  );
}

function invoiceStatus(paymentDate: string | null, balance: number, invoiceDate?: string | null) {
  if (paymentDate || balance <= 0) return 'Paid';
  if (invoiceDate) {
    const d = new Date(invoiceDate);
    if (!Number.isNaN(d.getTime()) && d.getTime() < startOfDay(new Date()).getTime()) return 'Overdue';
  }
  return 'Due';
}

export function ClientProjectBoard({
  project,
  mode,
  authorName,
  banner,
  projects = [],
  onSelectProject,
}: {
  project: ClientBoardProject;
  mode: ClientBoardMode;
  authorName: string;
  banner?: string | null;
  projects?: ClientBoardOption[];
  onSelectProject?: (projectKey: string) => void;
}) {
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [messages, setMessages] = useState<ClientMessage[]>([]);
  const [invoices, setInvoices] = useState<
    { invoice_date: string | null; payment_date: string | null; net: number; balance: number }[]
  >([]);
  const [tab, setTab] = useState<CenterTab>('overview');
  const [bellOpen, setBellOpen] = useState(false);
  const [alertTick, setAlertTick] = useState(0);
  const [reviews, setReviews] = useState(() => documentReviews(project.projectKey));
  const [openDone, setOpenDone] = useState<Record<string, boolean>>({});

  const loadSchedule = useCallback(async () => {
    const { data: scheds } = await supabase
      .from('pa_schedules')
      .select('id, project_key')
      .order('project_key');
    const list = (scheds || []) as { id: string; project_key: string }[];
    const needle = project.projectKey.toLowerCase();
    const hit =
      list.find((s) => s.project_key === project.projectKey) ||
      list.find((s) => {
        const k = s.project_key.toLowerCase();
        return k.includes(needle) || needle.includes(k);
      }) ||
      null;
    if (!hit) {
      setRows([]);
      return;
    }
    const { data } = await supabase
      .from('pa_schedule_rows')
      .select('*')
      .eq('schedule_id', hit.id)
      .order('sort_order');
    setRows((data || []) as ScheduleRow[]);
  }, [project.projectKey]);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('pa_client_messages')
        .select('*')
        .eq('project_key', project.projectKey)
        .order('created_at', { ascending: true });
      if (!cancelled) setMessages((data || []) as ClientMessage[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [project.projectKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('pa_invoice_ledger')
        .select('invoice_date, payment_date, net, balance')
        .eq('client', project.clientName)
        .order('invoice_date', { ascending: false })
        .limit(24);
      if (!cancelled) setInvoices((data || []) as typeof invoices);
    })();
    return () => {
      cancelled = true;
    };
  }, [project.clientName]);

  useEffect(() => {
    setReviews(documentReviews(project.projectKey));
  }, [project.projectKey]);

  const sections = useMemo(() => groupScheduleSections(rows), [rows]);
  const needsCount = useMemo(() => {
    let n = 0;
    for (const s of sections) {
      for (const row of s.items) {
        if (needsClientReply(row)) n += 1;
      }
    }
    return n;
  }, [sections]);
  const activeTitles = sections
    .filter((s) => /active/i.test(sectionStatus(s)) && !/not\s*active/i.test(sectionStatus(s)))
    .map((s) => s.title);
  const resolvedPhase = inferCurrentPhase(project.phase, activeTitles) || project.phase;
  const phaseIdx = matchProcessPhaseIndex(resolvedPhase);
  const currentPhase = phaseIdx >= 0 ? PROCESS_PHASES[phaseIdx] : null;
  const phaseLabel = processPhaseLabel(resolvedPhase);
  const [viewPhaseId, setViewPhaseId] = useState<ProcessPhaseId | null>(
    () => currentPhase?.id ?? PROCESS_PHASES[0]!.id,
  );

  useEffect(() => {
    if (currentPhase) setViewPhaseId(currentPhase.id);
  }, [currentPhase?.id]);

  const viewedIdx = PROCESS_PHASES.findIndex((p) => p.id === viewPhaseId);
  const viewedPhase =
    (viewedIdx >= 0 ? PROCESS_PHASES[viewedIdx] : null) || currentPhase || PROCESS_PHASES[0]!;
  const viewingCurrent = viewedPhase.id === currentPhase?.id;
  const nextIdx = phaseIdx >= 0 ? phaseIdx + 1 : -1;
  const mainCount = mainStageCount();
  const pct = stageProgressPct(phaseIdx);
  const displayTitle = displayPersonName(project.title);
  const contact = staffContact(project.manager);
  const pmName = project.manager || 'Your project manager';
  const callHref = contact?.email
    ? `mailto:${contact.email}?subject=${encodeURIComponent(`Schedule a call — ${displayTitle}`)}`
    : null;

  const today = startOfDay(new Date());
  const events = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sections) {
      for (const item of s.items) map.set(item.id, s.title);
      if (s.phaseRow) map.set(s.phaseRow.id, s.title);
    }
    return buildDeadlineEvents(rows, map).filter((e) => e.kind !== 'phase');
  }, [rows, sections]);

  const overdue = events.filter(
    (e) => e.date.getTime() < today.getTime() && !/completed|n\/a/i.test(e.status),
  );
  const seen = portalSeenAt(project.projectKey);
  const unreadMsgs = messages.filter(
    (m) => m.author_role === 'staff' && (!seen || new Date(m.created_at) > seen),
  );

  const alerts = useMemo(() => {
    const list: ClientAlert[] = [];
    for (const e of overdue.slice(0, 4)) {
      list.push({
        id: `due:${e.id}`,
        kind: 'overdue',
        title: `Past due: ${displayTaskTitle(e.task)}`,
        detail: 'Contact your PM if this date has shifted.',
        href: 'notes',
      });
    }
    if (unreadMsgs.length) {
      list.push({
        id: `unread:${unreadMsgs.length}`,
        kind: 'unread',
        title: `${unreadMsgs.length} unread message${unreadMsgs.length === 1 ? '' : 's'} from your PM`,
        detail: 'Open Direct Messages to read and reply.',
        href: 'messages',
      });
    }
    if (needsCount) {
      list.push({
        id: `need:${needsCount}`,
        kind: 'approval',
        title: `${needsCount} item${needsCount === 1 ? '' : 's'} need your input`,
        detail: 'Review schedule notes waiting on a client reply.',
        href: 'notes',
      });
    }
    return list.filter((a) => !isAlertDismissed(project.projectKey, a.id));
  }, [overdue, unreadMsgs.length, needsCount, project.projectKey, alertTick]);

  const bellCount = alerts.length;
  const health = milestoneHealth(overdue.length, needsCount);
  const targetDate = phaseEndFromRows(rows, viewedPhase.id) || 'Date TBD';
  const docs = useMemo(() => clientDeliverables(rows), [rows]);
  const contract = project.contract || 0;
  const billed = project.billed || 0;
  const outstanding = Math.max(contract - billed, project.ar || 0);
  const additionalFee = project.additionalFee || 0;

  function goTab(next: CenterTab) {
    setTab(next);
    window.requestAnimationFrame(() => {
      document.getElementById('cp-center')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function onStageClick(id: ProcessPhaseId, state: 'done' | 'current' | 'upcoming') {
    setViewPhaseId(id);
    if (state === 'done') setOpenDone((prev) => ({ ...prev, [id]: !prev[id] }));
    goTab('overview');
  }

  function handleAlert(a: ClientAlert) {
    if (a.href === 'notes') goTab('notes');
    else if (a.href === 'messages') {
      document.getElementById('cp-messages')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else goTab('overview');
  }

  function exportStatus() {
    downloadKvPdf({
      filename: `${displayTitle.replace(/[^\w]+/g, '-')}-status.pdf`,
      title: displayTitle,
      subtitle: `M. Designs client status · ${new Date().toLocaleDateString()}`,
      rows: [
        ['Client', displayPersonName(project.clientName)],
        ['Status', project.status || '—'],
        ['Current stage', currentPhase?.name || phaseLabel],
        ['Milestone', currentPhase?.milestone || '—'],
        ['Health', health],
        ['Est. complete', `${pct}%`],
        ['PM', pmName],
        ['PM email', contact?.email || '—'],
        ['Contract', contract ? fmtUSD(contract) : '—'],
        ['Billed', billed ? fmtUSD(billed) : '—'],
        ['Outstanding', outstanding ? fmtUSD(outstanding) : '—'],
        ['Items needing you', String(needsCount)],
        ['Past-due deadlines', String(overdue.length)],
      ],
    });
    if (docs.length) {
      downloadTablePdf({
        filename: `${displayTitle.replace(/[^\w]+/g, '-')}-deliverables.pdf`,
        title: 'Deliverables',
        subtitle: displayTitle,
        headers: ['Phase', 'Item', 'Status', 'Date'],
        rows: docs.map((d) => [d.section, d.task, d.status, d.date]),
      });
    }
  }

  const switcher = projects.filter((p) => p.projectKey !== project.projectKey).length > 0;

  return (
    <div className={`cp-board mode-${mode}`}>
      {banner ? <div className="cp-pm-banner">{banner}</div> : null}

      {alerts.length ? (
        <div className="cp-alert-bar" role="status">
          {alerts.map((a) => (
            <div key={a.id} className={`cp-alert-item kind-${a.kind}`}>
              <button type="button" className="cp-alert-jump" onClick={() => handleAlert(a)}>
                <strong>{a.title}</strong>
                <span>{a.detail}</span>
              </button>
              <button
                type="button"
                className="cp-alert-dismiss"
                aria-label={`Dismiss ${a.title}`}
                onClick={() => {
                  dismissAlert(project.projectKey, a.id);
                  setAlertTick((n) => n + 1);
                }}
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <header className="cp-dash-top">
        <div className="cp-dash-title">
          <div className="cp-kicker-row">
            <p className="customer-kicker">
              {mode === 'pm' ? 'Client portal preview' : 'Your project'}
            </p>
            {switcher && onSelectProject ? (
              <label className="cp-project-switch">
                <span className="visually-hidden">Switch project</span>
                <select
                  value={project.projectKey}
                  aria-label="Switch project"
                  onChange={(e) => onSelectProject(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.projectKey} value={p.projectKey}>
                      {displayPersonName(p.title)}
                      {p.status ? ` · ${p.status}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              className={`cp-bell${bellCount ? ' has-unread' : ''}`}
              aria-label={bellCount ? `${bellCount} notifications` : 'Notifications'}
              aria-expanded={bellOpen}
              onClick={() => {
                setBellOpen((v) => !v);
                markPortalSeen(project.projectKey);
                setAlertTick((n) => n + 1);
              }}
            >
              <span aria-hidden="true">🔔</span>
              {bellCount ? <span className="cp-bell-count">{bellCount > 9 ? '9+' : bellCount}</span> : null}
            </button>
            {bellOpen ? (
              <div className="cp-bell-menu" role="menu">
                {alerts.length ? (
                  alerts.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        handleAlert(a);
                        setBellOpen(false);
                      }}
                    >
                      {a.title}
                    </button>
                  ))
                ) : (
                  <p>You’re caught up.</p>
                )}
              </div>
            ) : null}
          </div>
          <h1 className="display cp-project-title">{displayTitle}</h1>
        </div>
        <div className="cp-print-actions">
          <button type="button" className="cp-text-btn" onClick={() => window.print()}>
            Print
          </button>
          <button type="button" className="cp-text-btn" onClick={exportStatus}>
            Export PDF
          </button>
        </div>
      </header>

      <section className="cp-summary-strip" aria-label="Project summary">
        <div>
          <span className="k">Project</span>
          <strong>{displayTitle}</strong>
        </div>
        <div>
          <span className="k">Status</span>
          <strong>
            {project.status ? (
              <span className={`badge ${(project.status || '').toLowerCase()}`}>{project.status}</span>
            ) : (
              '—'
            )}
          </strong>
          <span className="sub">{phaseLabel}</span>
        </div>
        <div className="cp-pm-block">
          <span className="k">Project manager</span>
          <strong>PM {pmName}</strong>
          {contact?.email ? (
            <a className="cp-pm-link" href={`mailto:${contact.email}`}>
              {contact.email}
            </a>
          ) : null}
          {contact?.phone ? <span className="sub">{contact.phone}</span> : null}
          {callHref ? (
            <a className="cp-pm-link" href={callHref}>
              Schedule a call
            </a>
          ) : null}
        </div>
        {project.city ? (
          <div>
            <span className="k">Location</span>
            <strong>{project.city}</strong>
          </div>
        ) : null}
      </section>

      <div className="cp-dash-grid">
        <aside className="cp-stages" aria-label="Project stages">
          <div className="cp-stages-head">
            <p className="customer-kicker">Stages</p>
            <p className="cp-stages-lede">
              {currentPhase && currentPhase.id !== 'additional'
                ? `Stage ${Math.min(phaseIdx + 1, mainCount)} of ${mainCount} · Est. ${pct}% complete`
                : currentPhase?.id === 'additional'
                  ? `Additional Services · Est. ${pct}% on base phases`
                  : 'Full process'}
            </p>
            <div className="cp-progress" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </div>
            <p className="cp-parallel-note">
              Additional Services and Interior Design can run in parallel with base contract phases.
            </p>
          </div>
          <ol className="cp-stage-rail">
            {PROCESS_PHASES.map((phase, i) => {
              const state = stageState(i, phaseIdx);
              const selected = viewedPhase.id === phase.id;
              const expanded = state !== 'done' || selected || openDone[phase.id];
              const badge =
                state === 'current' ? 'Now' : state === 'done' ? 'Done' : i === nextIdx ? 'Next' : 'Upcoming';
              const est = phaseEndFromRows(rows, phase.id);
              return (
                <li key={phase.id}>
                  <button
                    type="button"
                    className={`cp-stage-btn ${state}${selected ? ' selected' : ''}${expanded ? '' : ' collapsed'}`}
                    style={{ ['--phase' as string]: phase.color }}
                    onClick={() => onStageClick(phase.id, state)}
                    aria-current={state === 'current' ? 'step' : undefined}
                    aria-expanded={expanded}
                    title={glossaryTitle(phase.name) || glossaryTitle(phase.shortName)}
                  >
                    <span className="cp-stage-index mono" aria-hidden="true">
                      {state === 'done' ? '✓' : String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="cp-stage-copy">
                      <span className="cp-stage-name">
                        <Glossed text={phase.shortName} />
                      </span>
                      {expanded ? (
                        <>
                          <span className="cp-stage-mile">{phase.milestone}</span>
                          <span className="cp-stage-est mono">{est ? `Est. ${est}` : 'Date TBD'}</span>
                        </>
                      ) : null}
                    </span>
                    <span className={`cp-stage-state ${state} ${badge.toLowerCase()}`}>{badge}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <div className="cp-dash-main" id="cp-center">
          <div className="cp-center-tabs" role="tablist" aria-label="Project details">
            {(
              [
                ['overview', 'Overview'],
                ['documents', 'Documents'],
                ['budget', 'Budget'],
                ['notes', mode === 'customer' ? 'Schedule notes' : 'Notes'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`cp-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`cp-panel-${id}`}
                className={tab === id ? 'active' : ''}
                onClick={() => setTab(id)}
              >
                {id === 'notes' && needsCount ? `${label} (${needsCount})` : label}
              </button>
            ))}
          </div>

          {tab === 'overview' ? (
            <section
              className="cp-card cp-needs"
              id="cp-panel-overview"
              role="tabpanel"
              aria-labelledby="cp-tab-overview"
            >
              <div className="cp-needs-head">
                <div>
                  <p className="customer-kicker">
                    {viewingCurrent ? 'Where we are' : 'Stage preview'}
                  </p>
                  <h2 className="display">
                    <Glossed text={viewedPhase.name} />
                  </h2>
                  <p className="cp-phase-summary">{viewedPhase.summary}</p>
                  {!viewingCurrent && currentPhase ? (
                    <button
                      type="button"
                      className="cp-text-btn cp-back-now"
                      onClick={() => setViewPhaseId(currentPhase.id)}
                    >
                      Back to current stage
                    </button>
                  ) : null}
                </div>
                <div className="cp-milestone compact">
                  <span className="k">Milestone</span>
                  <span className="v">
                    <Glossed text={viewedPhase.milestone} />
                  </span>
                  <span className="cp-milestone-sub mono">Target · {targetDate}</span>
                  <span className={`cp-health ${health.toLowerCase().replace(' ', '-')}`}>{health}</span>
                </div>
              </div>

              <div className="cp-needs-grid">
                <div>
                  <h3>What we need from you</h3>
                  {viewedPhase.client.length ? (
                    <ul className="cp-action-list">
                      {viewedPhase.client.map((item) => {
                        const kind = clientNeedKind(item);
                        const feeLine =
                          /fee/i.test(item) && additionalFee
                            ? `Additional Services Fee: ${fmtUSD(additionalFee)} — pending your approval.`
                            : null;
                        return (
                          <li key={item}>
                            <label className="cp-action-check">
                              <input type="checkbox" disabled />
                              <span>
                                <Glossed text={item} />
                                {feeLine ? <em className="cp-fee-line">{feeLine}</em> : null}
                              </span>
                            </label>
                            {kind === 'approve' ? (
                              <button type="button" className="cp-text-btn" onClick={() => goTab('documents')}>
                                Review &amp; Approve
                              </button>
                            ) : null}
                            {kind === 'upload' && contact?.email ? (
                              <a
                                className="cp-text-btn"
                                href={`mailto:${contact.email}?subject=${encodeURIComponent(`Files for ${displayTitle}`)}`}
                              >
                                Upload files
                              </a>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="cp-comms-hint">Nothing needed from you in this stage right now.</p>
                  )}
                </div>
                <div>
                  <h3>What we’re doing</h3>
                  <ul className="cp-action-list readonly">
                    {viewedPhase.architect.map((item) => (
                      <li key={item}>
                        <span>
                          <Glossed text={item} />
                        </span>
                        <span className="mono cp-est-chip">Expected {targetDate}</span>
                        {/drawing|spec|document|package|board|plan/i.test(item) ? (
                          <button type="button" className="cp-text-btn" onClick={() => goTab('documents')}>
                            View deliverable
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          ) : null}

          {tab === 'documents' ? (
            <section
              className="cp-card"
              id="cp-panel-documents"
              role="tabpanel"
              aria-labelledby="cp-tab-documents"
            >
              <p className="customer-kicker">Documents &amp; deliverables</p>
              <h2 className="display">Files by stage</h2>
              <p className="cp-phase-summary">
                Grouped from the project schedule. Marking reviewed records the date on this device
                for you and the firm.
              </p>
              {!docs.length ? (
                <div className="cp-empty-card">
                  <p>No deliverable titles are on the schedule yet. Your PM can attach sets here as they are issued.</p>
                </div>
              ) : (
                <ul className="cp-doc-list">
                  {docs.map((d) => {
                    const rec = reviews[d.id];
                    return (
                      <li key={d.id}>
                        <div>
                          <span className="cp-msg-phase mono">{d.section}</span>
                          <strong title={glossaryTitle(d.task)}>
                            <Glossed text={d.task} />
                          </strong>
                          <span className="meta mono">
                            {d.status && d.status !== '—' ? `${d.status} · ` : ''}
                            {d.date
                              ? `Rev — uploaded ${d.date}`
                              : 'Version pending'}
                          </span>
                          {rec ? (
                            <span className="meta mono">
                              Reviewed {new Date(rec.at).toLocaleString()} by {rec.by}
                            </span>
                          ) : null}
                        </div>
                        <div className="cp-doc-actions">
                          {contact?.email ? (
                            <a
                              className="cp-text-btn"
                              href={`mailto:${contact.email}?subject=${encodeURIComponent(`Please send: ${d.task}`)}`}
                            >
                              Download / request
                            </a>
                          ) : null}
                          <button
                            type="button"
                            className="cp-text-btn"
                            disabled={!!rec}
                            onClick={() => {
                              const next = markDocumentReviewed(
                                project.projectKey,
                                d.id,
                                authorName,
                              );
                              setReviews((prev) => ({ ...prev, [d.id]: next }));
                            }}
                          >
                            {rec ? 'Reviewed' : 'Mark as reviewed'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : null}

          {tab === 'budget' ? (
            <section className="cp-card" id="cp-panel-budget" role="tabpanel" aria-labelledby="cp-tab-budget">
              <p className="customer-kicker">Budget &amp; payments</p>
              <h2 className="display">Contract summary</h2>
              <div className="cp-budget-kpis">
                <div>
                  <span className="k">Contract sum</span>
                  <strong>{contract ? fmtUSD(contract) : '—'}</strong>
                </div>
                <div>
                  <span className="k">Fees billed to date</span>
                  <strong>{billed ? fmtUSD(billed) : '—'}</strong>
                </div>
                <div>
                  <span className="k">Outstanding</span>
                  <strong>{outstanding ? fmtUSD(outstanding) : '—'}</strong>
                </div>
              </div>
              {additionalFee ? (
                <p className="cp-fee-line">
                  Additional Services fees: {fmtUSD(additionalFee)} — pending your approval.
                </p>
              ) : (
                <p className="cp-comms-hint">No separate Additional Services fee is on file for this project.</p>
              )}
              <h3 className="cp-subhead">Invoice history</h3>
              {!invoices.length ? (
                <div className="cp-empty-card">
                  <p>No invoices are listed for this client yet. Ask your PM if you need a copy of a past bill.</p>
                </div>
              ) : (
                <div className="cp-table-wrap">
                  <table className="cp-invoice-table">
                    <thead>
                      <tr>
                        <th>Invoice date</th>
                        <th>Paid</th>
                        <th>Amount</th>
                        <th>Balance</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv, i) => {
                        const status = invoiceStatus(inv.payment_date, inv.balance || 0, inv.invoice_date);
                        return (
                          <tr key={`${inv.invoice_date}-${i}`}>
                            <td>{inv.invoice_date || '—'}</td>
                            <td>{inv.payment_date || '—'}</td>
                            <td>{fmtUSD(inv.net || 0)}</td>
                            <td>{fmtUSD(inv.balance || 0)}</td>
                            <td>
                              <span className={`cp-pay-pill ${status.toLowerCase()}`}>{status}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="cp-comms-hint">
                Online payment is not enabled in this portal. Pay per your invoice instructions, or email{' '}
                {contact?.email || 'your project manager'} with questions.
              </p>
            </section>
          ) : null}

          {tab === 'notes' ? (
            <section
              className="cp-card cp-talk"
              id="cp-panel-notes"
              role="tabpanel"
              aria-labelledby="cp-tab-notes"
            >
              {mode === 'customer' ? (
                <>
                  <div className="cp-talk-head">
                    <p className="customer-kicker">Schedule notes</p>
                    <h2 className="display">
                      Item-level comments
                      {needsCount ? <span className="cp-need-badge">{needsCount} need you</span> : null}
                    </h2>
                    <p className="cp-phase-summary">
                      Default view shows only items waiting on you. Expand a row to reply.
                    </p>
                  </div>
                  <CustomerComms
                    projectKey={project.projectKey}
                    highlightPhase={resolvedPhase}
                    managerName={project.manager}
                    rowsOverride={rows}
                  />
                </>
              ) : (
                <>
                  <p className="customer-kicker">Schedule notes</p>
                  <p className="cp-phase-summary">
                    Edit firm notes and task status on the Project Schedule section of this dashboard
                    (below when you close preview). Direct messages are what the client sees first.
                  </p>
                  <ClientMeetingsPanel
                    projectKey={project.projectKey}
                    clientName={project.clientName}
                    compact
                  />
                </>
              )}
            </section>
          ) : null}
        </div>

        <aside className="cp-rail">
          <div id="cp-deadlines">
            <ScheduleDeadlineCalendar
              projectKey={project.projectKey}
              projectTitle={displayTitle}
              variant="sidebar"
              rowsOverride={rows}
              corner={false}
            />
          </div>
          <section className="cp-card cp-talk" id="cp-messages" aria-labelledby="cp-direct-title">
            <div className="cp-talk-head">
              <p className="customer-kicker">Direct messages</p>
              <h2 id="cp-direct-title" className="display">
                {mode === 'pm' ? 'Message your client' : 'Talk with your team'}
                {unreadMsgs.length ? <span className="cp-need-badge">{unreadMsgs.length} new</span> : null}
              </h2>
              <p className="cp-phase-summary">
                {mode === 'pm'
                  ? 'Notes here appear in the client portal immediately.'
                  : `${pmName} can reply here. Use Schedule notes for item-level comments.`}
              </p>
            </div>
            <ClientMessageThread project={project} mode={mode} authorName={authorName} />
          </section>
        </aside>
      </div>
    </div>
  );
}
