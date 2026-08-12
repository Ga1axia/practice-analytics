import { activityBucket, daysAgoYmd, isDeliveryHours, ymd, addDays } from './staffingDelivery';
import { phaseAbbrev, phaseDisplayName } from './phaseAbbrev';
import { classifyWorkType, type WorkType } from './workType';
import { supabase } from './supabase';
import type { TimeEntryLite } from './staffingTypes';

export type HistoryWindowDays = 30 | 90 | 180 | 365 | 0; // 0 = all imported

export type HoursSlice = {
  key: string;
  label: string;
  hours: number;
  share: number;
  billableHours: number;
};

export type ProjectTouch = {
  project: string;
  client: string | null;
  phase: string | null;
  phaseCode: string;
  workType: WorkType;
  hours: number;
  billableHours: number;
  entries: number;
  firstDate: string;
  lastDate: string;
};

export type EmployeeHistoryRow = {
  employeeName: string;
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
  deliveryHours: number;
  weeklyPace: number;
  activeWeeks: number;
  projectCount: number;
  phaseCount: number;
  topPhases: HoursSlice[];
  topProjects: HoursSlice[];
  topActivities: HoursSlice[];
  workTypes: HoursSlice[];
  specialties: string;
  currentlyWorkingOn: string;
  projects: ProjectTouch[];
  /** Mean hours on a project this person touched */
  avgHoursPerProject: number;
  /** Mean hours on a phase this person touched */
  avgHoursPerPhase: number;
};

/** One dimension (phase / activity / project type / project) across the firm. */
export type DimensionStat = {
  key: string;
  label: string;
  hours: number;
  share: number;
  billableHours: number;
  people: number;
  projects: number;
  /** Hours ÷ people who logged any time on this dimension */
  avgHoursPerPerson: number;
  /** Hours ÷ distinct projects that include this dimension */
  avgHoursPerProject: number;
};

export type FirmAverages = {
  avgHoursPerEmployee: number;
  avgBillablePerEmployee: number;
  avgWeeklyPace: number;
  avgProjectsPerEmployee: number;
  avgPhasesPerEmployee: number;
  /** Firm hours ÷ distinct projects */
  avgHoursPerProject: number;
  /** Mean of each person's avg hours/project */
  avgPersonProjectTouch: number;
  byPhase: DimensionStat[];
  byWorkType: DimensionStat[];
  byActivity: DimensionStat[];
  byProject: DimensionStat[];
};

export type FirmHistorySummary = {
  employees: number;
  entriesLoaded: number;
  totalHours: number;
  billableHours: number;
  deliveryHours: number;
  projectCount: number;
  fromDate: string | null;
  toDate: string | null;
  lastSyncAt: string | null;
};

export type HistoryAnalyticsResult = {
  summary: FirmHistorySummary;
  averages: FirmAverages;
  employees: EmployeeHistoryRow[];
  filterOptions: {
    employees: string[];
    phases: string[];
    activities: string[];
    workTypes: string[];
  };
  loadedAt: string;
};

type Acc = {
  hours: number;
  billable: number;
  label: string;
  people: Set<string>;
  projects: Set<string>;
};

function weeksSpanned(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime();
  const b = new Date(to + 'T00:00:00Z').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
  return Math.max(1, (b - a) / (7 * 86_400_000));
}

function activeWeekCount(dates: string[]): number {
  const weeks = new Set<string>();
  for (const d of dates) {
    const dt = new Date(d + 'T00:00:00Z');
    if (Number.isNaN(dt.getTime())) continue;
    const day = dt.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    dt.setUTCDate(dt.getUTCDate() + diff);
    weeks.add(ymd(dt));
  }
  return Math.max(1, weeks.size);
}

function toSlices(
  map: Map<string, { hours: number; billable: number; label: string }>,
  total: number,
  n = 5,
): HoursSlice[] {
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      hours: v.hours,
      billableHours: v.billable,
      share: total > 0 ? v.hours / total : 0,
    }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, n);
}

function emptyAcc(label: string): Acc {
  return { hours: 0, billable: 0, label, people: new Set(), projects: new Set() };
}

function bumpDim(
  map: Map<string, Acc>,
  key: string,
  label: string,
  hours: number,
  billable: boolean,
  employee: string,
  project: string,
) {
  const cur = map.get(key) || emptyAcc(label);
  cur.hours += hours;
  if (billable) cur.billable += hours;
  cur.people.add(employee);
  if (project) cur.projects.add(project);
  if (!cur.label) cur.label = label;
  map.set(key, cur);
}

function toDimensionStats(map: Map<string, Acc>, totalHours: number, n = 12): DimensionStat[] {
  return [...map.entries()]
    .map(([key, v]) => {
      const people = v.people.size;
      const projects = v.projects.size;
      return {
        key,
        label: v.label,
        hours: v.hours,
        share: totalHours > 0 ? v.hours / totalHours : 0,
        billableHours: v.billable,
        people,
        projects,
        avgHoursPerPerson: people > 0 ? v.hours / people : 0,
        avgHoursPerProject: projects > 0 ? v.hours / projects : 0,
      };
    })
    .sort((a, b) => b.hours - a.hours)
    .slice(0, n);
}

function emptyAverages(): FirmAverages {
  return {
    avgHoursPerEmployee: 0,
    avgBillablePerEmployee: 0,
    avgWeeklyPace: 0,
    avgProjectsPerEmployee: 0,
    avgPhasesPerEmployee: 0,
    avgHoursPerProject: 0,
    avgPersonProjectTouch: 0,
    byPhase: [],
    byWorkType: [],
    byActivity: [],
    byProject: [],
  };
}

function projectKey(e: TimeEntryLite): string {
  return (e.parent_project_name || e.project_name || 'Unassigned').trim() || 'Unassigned';
}

function phaseLabel(e: TimeEntryLite): string {
  return phaseDisplayName(e.phase_name || e.phase, e.project_name);
}

export function aggregateEmployeeHistory(
  entries: TimeEntryLite[],
  opts?: { employee?: string; phase?: string; workType?: WorkType },
): HistoryAnalyticsResult {
  const byEmployee = new Map<string, TimeEntryLite[]>();
  for (const e of entries) {
    const name = (e.employee_name || '').trim() || 'Unassigned';
    if (opts?.employee && name !== opts.employee) continue;
    if (opts?.phase) {
      const ph = phaseLabel(e);
      const code = phaseAbbrev(ph);
      if (ph !== opts.phase && code !== opts.phase) continue;
    }
    if (opts?.workType) {
      const wt = classifyWorkType(projectKey(e));
      if (wt !== opts.workType) continue;
    }
    const list = byEmployee.get(name) || [];
    list.push(e);
    byEmployee.set(name, list);
  }

  const employees: EmployeeHistoryRow[] = [];
  let firmHours = 0;
  let firmBill = 0;
  let firmDelivery = 0;
  const firmProjects = new Set<string>();
  let minDate: string | null = null;
  let maxDate: string | null = null;

  const firmPhase = new Map<string, Acc>();
  const firmActivity = new Map<string, Acc>();
  const firmWorkType = new Map<string, Acc>();
  const firmProject = new Map<string, Acc>();

  for (const [employeeName, rows] of [...byEmployee.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    let totalHours = 0;
    let billableHours = 0;
    let deliveryHours = 0;
    const dates: string[] = [];
    const phaseMap = new Map<string, { hours: number; billable: number; label: string }>();
    const projectMap = new Map<string, { hours: number; billable: number; label: string }>();
    const activityMap = new Map<string, { hours: number; billable: number; label: string }>();
    const typeMap = new Map<string, { hours: number; billable: number; label: string }>();
    const projectTouch = new Map<string, ProjectTouch>();

    for (const e of rows) {
      const hrs = Number(e.actual_hours) || 0;
      totalHours += hrs;
      if (e.is_billable) billableHours += hrs;
      const delivery = isDeliveryHours({
        isBillable: e.is_billable,
        isWrittenOff: e.is_written_off,
        isExtra: e.is_extra,
        activity: e.activity,
        projectName: e.project_name || e.parent_project_name,
        phase: e.phase || e.phase_name,
      });
      if (delivery) deliveryHours += hrs;
      if (e.work_date) {
        dates.push(e.work_date);
        if (!minDate || e.work_date < minDate) minDate = e.work_date;
        if (!maxDate || e.work_date > maxDate) maxDate = e.work_date;
      }

      const proj = projectKey(e);
      const phase = phaseLabel(e);
      const phaseCode = phaseAbbrev(phase);
      const phaseKey = phaseCode !== '—' ? phaseCode : phase;
      const act = activityBucket(e.activity);
      const wt = classifyWorkType(proj);

      firmProjects.add(proj);

      const bump = (
        map: Map<string, { hours: number; billable: number; label: string }>,
        key: string,
        label: string,
      ) => {
        const cur = map.get(key) || { hours: 0, billable: 0, label };
        cur.hours += hrs;
        if (e.is_billable) cur.billable += hrs;
        map.set(key, cur);
      };
      bump(phaseMap, phaseKey, phase);
      bump(projectMap, proj, proj);
      bump(activityMap, act, act);
      bump(typeMap, wt, wt);

      bumpDim(firmPhase, phaseKey, phase, hrs, !!e.is_billable, employeeName, proj);
      bumpDim(firmActivity, act, act, hrs, !!e.is_billable, employeeName, proj);
      bumpDim(firmWorkType, wt, wt, hrs, !!e.is_billable, employeeName, proj);
      bumpDim(firmProject, proj, proj, hrs, !!e.is_billable, employeeName, proj);

      const touchKey = `${proj}||${phase}`;
      const touch = projectTouch.get(touchKey) || {
        project: proj,
        client: e.client,
        phase,
        phaseCode,
        workType: wt,
        hours: 0,
        billableHours: 0,
        entries: 0,
        firstDate: e.work_date,
        lastDate: e.work_date,
      };
      touch.hours += hrs;
      if (e.is_billable) touch.billableHours += hrs;
      touch.entries += 1;
      if (e.work_date && e.work_date < touch.firstDate) touch.firstDate = e.work_date;
      if (e.work_date && e.work_date > touch.lastDate) touch.lastDate = e.work_date;
      if (!touch.client && e.client) touch.client = e.client;
      projectTouch.set(touchKey, touch);
    }

    const activeWeeks = activeWeekCount(dates);
    const empMin = dates.length ? dates.reduce((a, d) => (d < a ? d : a), dates[0]!) : null;
    const empMax = dates.length ? dates.reduce((a, d) => (d > a ? d : a), dates[0]!) : null;
    const spanWeeks = empMin && empMax ? weeksSpanned(empMin, empMax) : 1;
    const weeklyPace = totalHours / Math.max(activeWeeks, spanWeeks * 0.5);

    const topPhases = toSlices(phaseMap, totalHours, 6);
    const topProjects = toSlices(projectMap, totalHours, 6);
    const topActivities = toSlices(activityMap, totalHours, 6);
    const workTypes = toSlices(typeMap, totalHours, 8);
    const specialties = topActivities
      .slice(0, 3)
      .map((a) => `${a.label} ${Math.round(a.share * 100)}%`)
      .join(' · ');
    const currentlyWorkingOn = topProjects
      .slice(0, 3)
      .map((p) => `${p.label}: ${p.hours.toFixed(0)}h`)
      .join('; ');

    firmHours += totalHours;
    firmBill += billableHours;
    firmDelivery += deliveryHours;

    const projCount = projectMap.size;
    const phCount = phaseMap.size;

    employees.push({
      employeeName,
      totalHours,
      billableHours,
      nonBillableHours: Math.max(0, totalHours - billableHours),
      deliveryHours,
      weeklyPace,
      activeWeeks,
      projectCount: projCount,
      phaseCount: phCount,
      topPhases,
      topProjects,
      topActivities,
      workTypes,
      specialties: specialties || '—',
      currentlyWorkingOn: currentlyWorkingOn || 'No hours in range',
      projects: [...projectTouch.values()].sort((a, b) => b.hours - a.hours),
      avgHoursPerProject: projCount > 0 ? totalHours / projCount : 0,
      avgHoursPerPhase: phCount > 0 ? totalHours / phCount : 0,
    });
  }

  employees.sort((a, b) => b.totalHours - a.totalHours || a.employeeName.localeCompare(b.employeeName));

  const n = employees.length;
  const averages: FirmAverages =
    n === 0
      ? emptyAverages()
      : {
          avgHoursPerEmployee: firmHours / n,
          avgBillablePerEmployee: firmBill / n,
          avgWeeklyPace: employees.reduce((a, e) => a + e.weeklyPace, 0) / n,
          avgProjectsPerEmployee: employees.reduce((a, e) => a + e.projectCount, 0) / n,
          avgPhasesPerEmployee: employees.reduce((a, e) => a + e.phaseCount, 0) / n,
          avgHoursPerProject: firmProjects.size > 0 ? firmHours / firmProjects.size : 0,
          avgPersonProjectTouch:
            employees.reduce((a, e) => a + e.avgHoursPerProject, 0) / n,
          byPhase: toDimensionStats(firmPhase, firmHours, 14),
          byWorkType: toDimensionStats(firmWorkType, firmHours, 12),
          byActivity: toDimensionStats(firmActivity, firmHours, 12),
          byProject: toDimensionStats(firmProject, firmHours, 15),
        };

  return {
    summary: {
      employees: n,
      entriesLoaded: entries.length,
      totalHours: firmHours,
      billableHours: firmBill,
      deliveryHours: firmDelivery,
      projectCount: firmProjects.size,
      fromDate: minDate,
      toDate: maxDate,
      lastSyncAt: null,
    },
    averages,
    employees,
    filterOptions: {
      employees: employees.map((e) => e.employeeName),
      phases: averages.byPhase.map((p) => p.label).sort(),
      activities: averages.byActivity.map((a) => a.label).sort(),
      workTypes: averages.byWorkType.map((w) => w.label).sort(),
    },
    loadedAt: new Date().toISOString(),
  };
}

async function fetchEntriesInRange(
  fromDate: string | null,
  toDate: string,
  employeeName?: string,
): Promise<TimeEntryLite[]> {
  const teSelect =
    'id,bqe_time_entry_id,employee_id,employee_name,project_id,project_name,parent_project_name,phase,phase_name,client,activity_id,activity,work_date,actual_hours,is_billable,is_written_off,is_extra,description,memo';
  const out: TimeEntryLite[] = [];
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    let q = supabase
      .from('pa_time_entries')
      .select(teSelect)
      .lte('work_date', toDate)
      .order('work_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (fromDate) q = q.gte('work_date', fromDate);
    if (employeeName) q = q.eq('employee_name', employeeName);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const chunk = (data || []) as TimeEntryLite[];
    out.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
    if (from > 250_000) break;
  }
  return out;
}

export async function loadHistoryAnalytics(input: {
  windowDays: HistoryWindowDays;
  employee?: string;
  phase?: string;
  workType?: WorkType;
}): Promise<HistoryAnalyticsResult> {
  const now = new Date();
  const toDate = ymd(addDays(now, 1));
  const fromDate = input.windowDays === 0 ? null : daysAgoYmd(input.windowDays, now);

  let probeQ = supabase
    .from('pa_time_entries')
    .select('id', { count: 'exact', head: true })
    .lte('work_date', toDate);
  if (input.employee) probeQ = probeQ.eq('employee_name', input.employee);
  const probe = await probeQ;
  if (probe.error) {
    throw new Error(
      probe.error.message ||
        'Cannot read pa_time_entries. Confirm staffing migration and admin role.',
    );
  }
  if ((probe.count || 0) === 0) {
    return aggregateEmployeeHistory([], {
      employee: input.employee,
      phase: input.phase,
      workType: input.workType,
    });
  }

  const [entries, syncRun] = await Promise.all([
    fetchEntriesInRange(fromDate, toDate, input.employee),
    supabase
      .from('pa_bqe_sync_runs')
      .select('completed_at')
      .in('sync_type', ['historical', 'incremental'])
      .in('status', ['succeeded', 'partial'])
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const result = aggregateEmployeeHistory(entries, {
    employee: input.employee,
    phase: input.phase,
    workType: input.workType,
  });
  result.summary.lastSyncAt = (syncRun.data?.completed_at as string) || null;
  return result;
}
