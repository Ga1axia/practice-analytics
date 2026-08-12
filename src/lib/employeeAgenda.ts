import type { ClientMeeting } from '../components/ClientMeetingsPanel';
import { buildDemoProjectDetail } from './demoProjectDetail';
import { loadProjectSchedule } from './loadProjectSchedule';
import type { ProjectNode } from './projectListHierarchy';
import { buildDeadlineEvents, startOfDay } from './scheduleDates';
import { ensureProjectSchedule } from './scheduleEnsure';
import { groupScheduleSections } from './scheduleSections';
import { supabase } from './supabase';

export type AgendaKind = 'meeting' | 'deadline' | 'task';

export type AgendaItem = {
  id: string;
  kind: AgendaKind;
  title: string;
  date: Date;
  dateKey: string;
  projectKey: string;
  projectTitle: string;
  clientName: string;
  status: string;
  section?: string;
};

function dateKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function managerFor(p: ProjectNode & { clientName: string }, fallback: string) {
  return (
    p.row?.manager ||
    p.phases.find((ph) => ph.row.manager)?.row.manager ||
    fallback
  );
}

/** Build upcoming agenda across an employee's projects (optional demo fallback). */
export async function loadEmployeeAgenda(
  projects: (ProjectNode & { clientName: string })[],
  employeeName: string,
  options?: { allowDemoSeed?: boolean },
): Promise<{ items: AgendaItem[]; usedDemo: boolean }> {
  const allowDemoSeed = options?.allowDemoSeed === true;
  const items: AgendaItem[] = [];
  let usedDemo = false;
  const clients = [...new Set(projects.map((p) => p.clientName))];

  const meetingByClient = new Map<string, ClientMeeting[]>();
  if (clients.length) {
    const { data } = await supabase
      .from('pa_client_meetings')
      .select('*')
      .in('client_name', clients)
      .order('meeting_at', { ascending: true });
    for (const m of (data || []) as ClientMeeting[]) {
      const list = meetingByClient.get(m.client_name) || [];
      list.push(m);
      meetingByClient.set(m.client_name, list);
    }
  }

  // Cap parallel schedule loads for large books
  const slice = projects.slice(0, 40);

  await Promise.all(
    slice.map(async (p) => {
      const ensured = await ensureProjectSchedule({
        projectKey: p.key,
        clientName: p.clientName,
        title: p.title,
      });
      let dbRows = ensured.rows;
      if (!dbRows.length && !ensured.error) {
        const loaded = await loadProjectSchedule(p.key);
        dbRows = loaded.rows;
      }
      const demo = allowDemoSeed
        ? buildDemoProjectDetail(p.key, p.clientName, managerFor(p, employeeName))
        : null;
      const rows = dbRows.length ? dbRows : demo?.rows || [];
      if (allowDemoSeed && !dbRows.length) usedDemo = true;

      const sections = groupScheduleSections(rows);
      const map = new Map<string, string>();
      for (const s of sections) {
        for (const item of s.items) map.set(item.id, s.title);
        if (s.phaseRow) map.set(s.phaseRow.id, s.title);
      }

      for (const e of buildDeadlineEvents(rows, map)) {
        if (e.kind === 'phase') continue;
        items.push({
          id: `${p.key}:${e.id}`,
          kind: e.kind === 'subtask' ? 'task' : 'deadline',
          title: e.task,
          date: e.date,
          dateKey: e.dateKey,
          projectKey: p.key,
          projectTitle: p.title,
          clientName: p.clientName,
          status: e.status,
          section: e.section,
        });
      }

      let meetings = meetingByClient.get(p.clientName) || [];
      meetings = meetings.filter(
        (m) => !m.project_key || m.project_key === p.key || m.project_key.includes(p.key),
      );
      if (!meetings.length && demo) {
        meetings = demo.meetings;
        usedDemo = true;
      }
      for (const m of meetings) {
        const d = new Date(m.meeting_at);
        if (Number.isNaN(d.getTime())) continue;
        // Avoid double-counting the same meeting across projects for one client
        const mid = `mtg:${m.id}:${p.key}`;
        if (items.some((x) => x.id.startsWith(`mtg:${m.id}:`))) continue;
        items.push({
          id: mid,
          kind: 'meeting',
          title: m.title || 'Client meeting',
          date: d,
          dateKey: dateKey(startOfDay(d)),
          projectKey: p.key,
          projectTitle: p.title,
          clientName: p.clientName,
          status: m.attendees || '',
          section: 'Meeting',
        });
      }
    }),
  );

  items.sort((a, b) => a.date.getTime() - b.date.getTime() || a.title.localeCompare(b.title));
  return { items, usedDemo };
}
