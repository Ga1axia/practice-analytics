import type { ClientMeeting } from '../components/ClientMeetingsPanel';
import type { ClientMessage } from './clientBoardTypes';
import type { ScheduleRow, ScheduleRowKind } from './scheduleTypes';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function offsetDate(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}

function offsetIso(days: number, hour = 10): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function row(
  scheduleId: string,
  sort: number,
  kind: ScheduleRowKind,
  task: string,
  status: string,
  start: string,
  end: string,
  firm = '',
  client = '',
): ScheduleRow {
  return {
    id: `demo-${scheduleId}-${sort}`,
    schedule_id: scheduleId,
    sort_order: sort,
    row_kind: kind,
    task,
    budget_remaining: status,
    target_start: start,
    target_end: end,
    actual_start: '',
    actual_end: '',
    action: '',
    estimate_time: '',
    mdesigns_comments: firm,
    client_comments: client,
    assignee_name: '',
  };
}

/** Local demo payload so employee project detail is populated before real schedules exist. */
export function buildDemoProjectDetail(projectKey: string, clientName: string, manager: string) {
  const scheduleId = `demo-sched-${projectKey.slice(0, 24)}`;

  const rows: ScheduleRow[] = [
    row(scheduleId, 0, 'phase', 'Schematic Design', '', '', ''),
    row(
      scheduleId,
      1,
      'task',
      'Planning package documents',
      'Active',
      offsetDate(-10),
      offsetDate(5),
      'Draft package shared for client review.',
      'We will send title report this week.',
    ),
    row(
      scheduleId,
      2,
      'subtask',
      'Site photos / survey documents',
      'Completed',
      offsetDate(-21),
      offsetDate(-14),
    ),
    row(
      scheduleId,
      3,
      'task',
      'Concept drawings set',
      'Active',
      offsetDate(3),
      offsetDate(12),
      'Waiting on preferred material board direction.',
    ),
    row(scheduleId, 4, 'phase', 'Design Development', '', '', ''),
    row(
      scheduleId,
      5,
      'task',
      'DD drawing package',
      'TBD',
      offsetDate(14),
      offsetDate(28),
    ),
    row(
      scheduleId,
      6,
      'task',
      'Interior finish board',
      offsetDate(-2),
      offsetDate(-9),
      offsetDate(-2),
      'Please confirm stain sample A vs B.',
    ),
    row(
      scheduleId,
      7,
      'subtask',
      'Consultant coordination report',
      'Active',
      offsetDate(20),
      offsetDate(34),
    ),
  ];

  const meetings: ClientMeeting[] = [
    {
      id: `demo-mtg-1-${projectKey}`,
      project_key: projectKey,
      client_name: clientName,
      meeting_at: offsetIso(-12, 11),
      title: 'Kickoff / program review',
      attendees: `${manager}, ${clientName}`,
      notes: 'Confirmed scope, budget band, and preferred meeting cadence (biweekly).',
      created_at: offsetIso(-12),
      updated_at: offsetIso(-12),
    },
    {
      id: `demo-mtg-2-${projectKey}`,
      project_key: projectKey,
      client_name: clientName,
      meeting_at: offsetIso(4, 15),
      title: 'SD pin-up',
      attendees: `${manager}, ${clientName}, Design team`,
      notes: 'Review planning package + concept drawings. Capture finish preferences.',
      created_at: offsetIso(-1),
      updated_at: offsetIso(-1),
    },
  ];

  const messages: ClientMessage[] = [
    {
      id: `demo-msg-1-${projectKey}`,
      project_key: projectKey,
      client_name: clientName,
      author_role: 'staff',
      author_name: manager,
      body: 'Sharing the planning package draft and calendar for the next two weeks. Please flag any site access constraints.',
      created_at: offsetIso(-6, 9),
      created_by: null,
    },
    {
      id: `demo-msg-2-${projectKey}`,
      project_key: projectKey,
      client_name: clientName,
      author_role: 'customer',
      author_name: clientName,
      body: 'Thanks — title report is coming Thursday. Can we move the SD pin-up to the afternoon?',
      created_at: offsetIso(-5, 16),
      created_by: null,
    },
    {
      id: `demo-msg-3-${projectKey}`,
      project_key: projectKey,
      client_name: clientName,
      author_role: 'staff',
      author_name: manager,
      body: 'Afternoon works. I updated the meeting and left notes on the finish board item.',
      created_at: offsetIso(-4, 10),
      created_by: null,
    },
  ];

  return { rows, meetings, messages, isDemo: true as const };
}
