import {
  daysAgoYmd,
  isDeliveryHours,
  weekStarts,
  workloadStatus,
  ymd,
  addDays,
} from './staffingDelivery';
import type {
  EmployeeCapacityRow,
  FirmStaffingSummary,
  PhaseAllocation,
  ProjectPhaseStaffing,
  ProjectStaffingProfile,
  StaffingBoardFilters,
  StaffingBoardResult,
  TimeEntryLite,
  TimeOffRow,
  WeekCapacitySlice,
  ActivePhaseDetail,
  EmployeeWorkloadRow,
} from './staffingTypes';

const STALE_SYNC_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_CAPACITY = 32;

function parseSkills(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function sumTimeOffForWeek(rows: TimeOffRow[], emp: string, weekStart: string): number {
  const end = ymd(addDays(new Date(weekStart + 'T00:00:00Z'), 6));
  let n = 0;
  for (const r of rows) {
    if (r.employee_name !== emp) continue;
    if (r.off_date >= weekStart && r.off_date <= end) n += Number(r.hours) || 0;
  }
  return n;
}

type PhaseKey = string;

function phaseKeyOf(project: string | null, phase: string | null): PhaseKey {
  return `${project || '—'}||${phase || '—'}`;
}

export function buildWeekSlice(
  capacity: number,
  plannedDelivery: number,
  timeOff: number,
  weekStart: string,
): WeekCapacitySlice {
  const open = Math.max(0, capacity - plannedDelivery - timeOff);
  const util = capacity > 0 ? plannedDelivery / capacity : 0;
  const over =
    plannedDelivery + timeOff > capacity
      ? plannedDelivery + timeOff - capacity
      : 0;
  return {
    weekStart,
    capacity,
    plannedDelivery,
    timeOff,
    openCapacity: open,
    deliveryUtilization: util,
    status: workloadStatus(util),
    overCapacityHours: over,
  };
}

/**
 * Pure aggregation used by the board and unit tests.
 */
export function aggregateStaffingBoard(input: {
  capacities: EmployeeCapacityRow[];
  rosterNames: string[];
  entries: TimeEntryLite[];
  allocations: PhaseAllocation[];
  timeOff: TimeOffRow[];
  profiles: ProjectStaffingProfile[];
  phases: ProjectPhaseStaffing[];
  filters: StaffingBoardFilters;
  now?: Date;
  lastTimeEntrySyncAt?: string | null;
}): StaffingBoardResult {
  const now = input.now || new Date();
  const trailingDays = input.filters.trailingDays;
  const horizon = input.filters.horizonWeeks;
  const weeks = weekStarts(now, horizon);
  const thisWeek = weeks[0]!;
  const trailStart = daysAgoYmd(trailingDays, now);
  const trail14Start = daysAgoYmd(14, now);
  const trail7Start = daysAgoYmd(7, now);
  const trail30Start = daysAgoYmd(30, now);
  // Inclusive end: allow same-day + minor clock skew / mistyped near-future CORE dates
  // within the selected trailing window (do not require work_date <= UTC today only).
  const trailEnd = ymd(addDays(now, 1));

  const capacityByName = new Map<string, EmployeeCapacityRow>();
  for (const c of input.capacities) {
    if (!c.active) continue;
    capacityByName.set(c.employee_name, {
      ...c,
      skills: parseSkills(c.skills),
    });
  }

  const names = new Set<string>();
  for (const n of input.rosterNames) if (n) names.add(n);
  for (const c of capacityByName.keys()) names.add(c);
  for (const e of input.entries) if (e.employee_name) names.add(e.employee_name);
  for (const a of input.allocations) if (a.employee_name) names.add(a.employee_name);

  const profileById = new Map(input.profiles.map((p) => [p.id, p]));
  const phaseById = new Map(input.phases.map((p) => [p.id, p]));

  const employees: EmployeeWorkloadRow[] = [];

  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    const cap = capacityByName.get(name);
    const weeklyCapacity = Number(cap?.weekly_capacity_hours) || DEFAULT_CAPACITY;
    const role = cap?.role || null;
    const discipline = cap?.discipline || null;
    const active = cap ? !!cap.active : true;
    const employeeId = cap?.employee_id || null;

    if (input.filters.employee && name !== input.filters.employee) continue;
    if (input.filters.role && role !== input.filters.role) continue;
    if (input.filters.discipline && discipline !== input.filters.discipline) continue;

    const empEntries = input.entries.filter((e) => e.employee_name === name);
    let t7 = 0;
    let t14 = 0;
    let t30 = 0;
    let t30Nb = 0;
    let missingProject = 0;
    let missingPhase = 0;
    let missingEmployee = 0;

    type Acc = {
      projectName: string;
      parentProjectName: string | null;
      phase: string | null;
      client: string | null;
      h14: number;
      hTrail: number;
    };
    const phaseAcc = new Map<PhaseKey, Acc>();

    for (const e of empEntries) {
      if (!e.employee_name) missingEmployee += 1;
      if (!e.project_name && !e.parent_project_name) missingProject += 1;
      if (!e.phase && !e.phase_name) missingPhase += 1;

      const delivery = isDeliveryHours({
        isBillable: e.is_billable,
        isWrittenOff: e.is_written_off,
        isExtra: e.is_extra,
        activity: e.activity,
        projectName: e.project_name || e.parent_project_name,
        phase: e.phase || e.phase_name,
      });
      const hrs = Number(e.actual_hours) || 0;
      if (e.work_date >= trail7Start && e.work_date <= trailEnd) {
        if (delivery) t7 += hrs;
      }
      if (e.work_date >= trail14Start && e.work_date <= trailEnd) {
        if (delivery) t14 += hrs;
      }
      if (e.work_date >= trail30Start && e.work_date <= trailEnd) {
        if (delivery) t30 += hrs;
        else t30Nb += hrs;
      }
      if (e.work_date >= trailStart && e.work_date <= trailEnd && delivery) {
        const proj = e.parent_project_name || e.project_name || 'Unassigned';
        const phase = e.phase_name || e.phase;
        const key = phaseKeyOf(proj, phase);
        const cur = phaseAcc.get(key) || {
          projectName: proj,
          parentProjectName: e.parent_project_name,
          phase,
          client: e.client,
          h14: 0,
          hTrail: 0,
        };
        cur.hTrail += hrs;
        if (e.work_date >= trail14Start) cur.h14 += hrs;
        phaseAcc.set(key, cur);
      }
    }

    const empAlloc = input.allocations.filter((a) => a.employee_name === name);
    const plannedByWeek = new Map<string, number>();
    for (const a of empAlloc) {
      if (input.filters.phase) {
        const ph = phaseById.get(a.project_phase_staffing_id);
        if (ph && ph.phase_name !== input.filters.phase && ph.phase_code !== input.filters.phase) {
          continue;
        }
      }
      if (input.filters.projectType) {
        const prof = profileById.get(a.project_staffing_profile_id);
        if (prof && prof.project_type !== input.filters.projectType) continue;
      }
      plannedByWeek.set(
        a.week_start,
        (plannedByWeek.get(a.week_start) || 0) + (Number(a.planned_hours) || 0),
      );
    }

    // Active phases: ≥2 delivery hrs in trailing 14d OR planned in horizon
    const activePhases: ActivePhaseDetail[] = [];
    const seenPhase = new Set<string>();

    for (const acc of phaseAcc.values()) {
      if (acc.h14 < 2) continue;
      const key = phaseKeyOf(acc.projectName, acc.phase);
      seenPhase.add(key);
      activePhases.push({
        projectName: acc.projectName,
        parentProjectName: acc.parentProjectName,
        phase: acc.phase,
        client: acc.client,
        trailingDeliveryHours: acc.hTrail,
        weeklyPace: acc.h14 / 2,
        plannedThisWeek: 0,
        plannedHorizon: 0,
        source: 'observed',
      });
    }

    for (const a of empAlloc) {
      if (!weeks.includes(a.week_start)) continue;
      if ((Number(a.planned_hours) || 0) <= 0) continue;
      const ph = phaseById.get(a.project_phase_staffing_id);
      const prof = profileById.get(a.project_staffing_profile_id);
      if (input.filters.phase && ph) {
        if (ph.phase_name !== input.filters.phase && ph.phase_code !== input.filters.phase) continue;
      }
      if (input.filters.projectType && prof?.project_type !== input.filters.projectType) continue;
      const projName = prof?.project_name || 'Project';
      const phaseName = ph?.phase_name || null;
      const key = phaseKeyOf(projName, phaseName);
      const existing = activePhases.find(
        (p) => phaseKeyOf(p.projectName, p.phase) === key,
      );
      const hrs = Number(a.planned_hours) || 0;
      if (existing) {
        if (a.week_start === thisWeek) existing.plannedThisWeek += hrs;
        existing.plannedHorizon += hrs;
        existing.source = existing.source === 'observed' ? 'both' : existing.source;
      } else if (!seenPhase.has(key)) {
        seenPhase.add(key);
        activePhases.push({
          projectName: projName,
          parentProjectName: null,
          phase: phaseName,
          client: prof?.client || null,
          trailingDeliveryHours: 0,
          weeklyPace: 0,
          plannedThisWeek: a.week_start === thisWeek ? hrs : 0,
          plannedHorizon: hrs,
          source: 'planned',
        });
      } else {
        /* already counted */
      }
    }

    // Merge planned hours onto observed active phases
    for (const ap of activePhases) {
      if (ap.source === 'planned') continue;
      for (const a of empAlloc) {
        const ph = phaseById.get(a.project_phase_staffing_id);
        const prof = profileById.get(a.project_staffing_profile_id);
        if (!ph || !prof) continue;
        if (prof.project_name !== ap.projectName) continue;
        if ((ph.phase_name || null) !== (ap.phase || null)) continue;
        const hrs = Number(a.planned_hours) || 0;
        if (a.week_start === thisWeek) ap.plannedThisWeek += hrs;
        if (weeks.includes(a.week_start)) ap.plannedHorizon += hrs;
        if (hrs > 0) ap.source = 'both';
      }
    }

    activePhases.sort((a, b) => b.weeklyPace - a.weeklyPace || b.plannedHorizon - a.plannedHorizon);

    const weekSlices = weeks.map((w) =>
      buildWeekSlice(
        weeklyCapacity,
        plannedByWeek.get(w) || 0,
        sumTimeOffForWeek(input.timeOff, name, w),
        w,
      ),
    );
    const thisSlice = weekSlices[0]!;
    const plannedHorizon = weekSlices.reduce((s, w) => s + w.plannedDelivery, 0);
    const openHorizon = weekSlices.reduce((s, w) => s + w.openCapacity, 0);

    const top = activePhases.slice(0, 3);
    const currentlyWorkingOn = top.length
      ? top
          .map((p) => {
            const phase = p.phase ? ` — ${p.phase}` : '';
            const pace = p.weeklyPace > 0 ? `${p.weeklyPace.toFixed(0)}h/wk` : 'planned';
            return `${p.projectName}${phase}: ${pace}`;
          })
          .join('; ')
      : 'No active delivery phases';

    const allocationGap = empAlloc.filter((a) => weeks.includes(a.week_start)).length === 0;

    employees.push({
      employeeName: name,
      employeeId,
      role,
      discipline,
      active,
      weeklyCapacity,
      trailing7Delivery: t7,
      trailing14Delivery: t14,
      trailing30Delivery: t30,
      currentWeeklyPace: t14 / 2,
      trailing30NonDelivery: t30Nb,
      plannedThisWeek: thisSlice.plannedDelivery,
      timeOffThisWeek: thisSlice.timeOff,
      openCapacityThisWeek: thisSlice.openCapacity,
      plannedHorizon,
      openCapacityHorizon: openHorizon,
      deliveryUtilizationThisWeek: thisSlice.deliveryUtilization,
      status: thisSlice.status,
      activeProjectCount: new Set(activePhases.map((p) => p.projectName)).size,
      activePhaseCount: activePhases.length,
      activePhases,
      currentlyWorkingOn,
      weeks: weekSlices,
      dataQuality: {
        missingEmployee: missingEmployee,
        missingProject,
        missingPhase,
        allocationGap,
      },
    });
  }

  // Filter by phase / project type presence on active work
  let filtered = employees;
  if (input.filters.phase) {
    const ph = input.filters.phase;
    filtered = filtered.filter((e) =>
      e.activePhases.some((p) => p.phase === ph),
    );
  }
  if (input.filters.projectType) {
    const types = new Set(
      input.profiles
        .filter((p) => p.project_type === input.filters.projectType)
        .map((p) => p.project_name),
    );
    filtered = filtered.filter((e) =>
      e.activePhases.some((p) => types.has(p.projectName)),
    );
  }

  const hasTimeEntries = input.entries.length > 0;
  const hasAllocations = input.allocations.some((a) => weeks.includes(a.week_start));
  const lastSync = input.lastTimeEntrySyncAt || null;
  const syncStale =
    !lastSync || Date.now() - new Date(lastSync).getTime() > STALE_SYNC_MS;
  const observedDeliveryHours = filtered.reduce((s, e) => {
    if (trailingDays === 7) return s + e.trailing7Delivery;
    if (trailingDays === 30) return s + e.trailing30Delivery;
    return s + e.trailing14Delivery;
  }, 0);

  const summary: FirmStaffingSummary = {
    totalWeeklyCapacity: filtered.reduce((s, e) => s + e.weeklyCapacity, 0),
    plannedDeliveryThisWeek: filtered.reduce((s, e) => s + e.plannedThisWeek, 0),
    openDeliveryThisWeek: filtered.reduce((s, e) => s + e.openCapacityThisWeek, 0),
    nearCapacityCount: filtered.filter((e) => e.status === 'near_capacity' || e.status === 'at_capacity')
      .length,
    overCapacityCount: filtered.filter((e) => e.status === 'over_capacity').length,
    activeEmployeePhaseAssignments: filtered.reduce((s, e) => s + e.activePhaseCount, 0),
    unallocatedCapacityHorizon: filtered.reduce((s, e) => s + e.openCapacityHorizon, 0),
    observedEntriesLoaded: input.entries.length,
    observedDeliveryHours,
    hasTimeEntries,
    hasAllocations,
    lastTimeEntrySyncAt: lastSync,
    syncStale,
  };

  const filterOptions = {
    roles: [...new Set(employees.map((e) => e.role).filter(Boolean) as string[])].sort(),
    disciplines: [
      ...new Set(employees.map((e) => e.discipline).filter(Boolean) as string[]),
    ].sort(),
    employees: employees.map((e) => e.employeeName).sort(),
    projectTypes: [
      ...new Set(input.profiles.map((p) => p.project_type).filter(Boolean) as string[]),
    ].sort(),
    phases: [
      ...new Set(
        [
          ...input.phases.map((p) => p.phase_name),
          ...input.entries.map((e) => e.phase_name || e.phase || '').filter(Boolean),
        ] as string[],
      ),
    ].sort(),
  };

  return {
    summary,
    employees: filtered.sort(
      (a, b) =>
        b.currentWeeklyPace - a.currentWeeklyPace ||
        b.deliveryUtilizationThisWeek - a.deliveryUtilizationThisWeek ||
        a.employeeName.localeCompare(b.employeeName),
    ),
    weekStarts: weeks,
    filterOptions,
    loadedAt: now.toISOString(),
  };
}

