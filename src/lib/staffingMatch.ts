import { addDays, weekStarts, workloadStatus, ymd } from './staffingDelivery';
import type {
  EmployeeWorkloadRow,
  MatchCandidate,
  MatchRequest,
  MatchResult,
  MatchScoreBreakdown,
  TimeEntryLite,
  WeekCapacitySlice,
} from './staffingTypes';
import { buildWeekSlice } from './staffingAggregate';

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function parseSkills(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s).toLowerCase());
  return [];
}

/**
 * Explainable staffing match ranking (no ML).
 * Weights: capacity 50%, experience 30%, continuity 15%, stability 5%.
 */
export function rankStaffingMatches(input: {
  request: MatchRequest;
  employees: EmployeeWorkloadRow[];
  capacities: {
    employee_name: string;
    role: string | null;
    discipline: string | null;
    skills: unknown;
    weekly_capacity_hours: number;
    active: boolean;
  }[];
  entries: TimeEntryLite[];
  now?: Date;
}): MatchResult {
  const req = input.request;
  if (!req.phase?.trim()) throw new Error('Phase is required');
  if (!Number.isFinite(req.hoursPerWeek) || req.hoursPerWeek <= 0) {
    throw new Error('Requested hours per week must be > 0');
  }
  if (!Number.isFinite(req.durationWeeks) || req.durationWeeks < 1) {
    throw new Error('Duration must be at least 1 week');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.startWeek)) {
    throw new Error('startWeek must be YYYY-MM-DD');
  }

  const now = input.now || new Date();
  const duration = Math.min(Math.floor(req.durationWeeks), 26);
  const requestedWeeks = weekStarts(new Date(req.startWeek + 'T00:00:00Z'), duration);
  // Align to exact start week label if provided as a Monday
  if (requestedWeeks[0] !== req.startWeek) {
    requestedWeeks[0] = req.startWeek;
    for (let i = 1; i < duration; i += 1) {
      requestedWeeks[i] = ymd(addDays(new Date(req.startWeek + 'T00:00:00Z'), i * 7));
    }
  }

  const yearAgo = ymd(addDays(now, -365));
  const requiredSkills = (req.skills || []).map((s) => s.toLowerCase().trim()).filter(Boolean);
  const capByName = new Map(input.capacities.map((c) => [c.employee_name, c]));

  const all: MatchCandidate[] = [];

  for (const emp of input.employees) {
    const cap = capByName.get(emp.employeeName);
    const skills = parseSkills(cap?.skills);
    const conflicts: string[] = [];
    let eligible = true;
    let exclusionReason: string | null = null;

    if (cap && cap.active === false) {
      eligible = false;
      exclusionReason = 'Employee marked inactive';
    }
    if (eligible && req.roleNeeded && emp.role && emp.role !== req.roleNeeded) {
      eligible = false;
      exclusionReason = `Role mismatch (has ${emp.role}, need ${req.roleNeeded})`;
    } else if (eligible && req.roleNeeded && !emp.role) {
      conflicts.push('Role not set on capacity profile');
    }
    if (eligible && requiredSkills.length) {
      const missing = requiredSkills.filter((s) => !skills.includes(s));
      if (missing.length) {
        eligible = false;
        exclusionReason = `Missing skills: ${missing.join(', ')}`;
      }
    }

    const weekPreview: WeekCapacitySlice[] = [];
    let lowestOpen = Infinity;
    let anyOver = false;
    for (const w of requestedWeeks) {
      const base = emp.weeks.find((x) => x.weekStart === w) || {
        weekStart: w,
        capacity: emp.weeklyCapacity,
        plannedDelivery: 0,
        timeOff: 0,
        openCapacity: emp.weeklyCapacity,
        deliveryUtilization: 0,
        status: 'available' as const,
        overCapacityHours: 0,
      };
      const plannedAfter = base.plannedDelivery + req.hoursPerWeek;
      const slice = buildWeekSlice(base.capacity, plannedAfter, base.timeOff, w);
      weekPreview.push(slice);
      lowestOpen = Math.min(lowestOpen, Math.max(0, base.capacity - plannedAfter - base.timeOff));
      if (base.timeOff > 0) conflicts.push(`PTO/time-off in week ${w}`);
      if (slice.status === 'over_capacity' || slice.status === 'near_capacity') {
        conflicts.push(`${slice.status.replace('_', ' ')} in week ${w}`);
      }
      if (plannedAfter + base.timeOff > base.capacity) anyOver = true;
    }
    if (lowestOpen === Infinity) lowestOpen = 0;

    if (eligible && anyOver && !req.showConstrained) {
      eligible = false;
      exclusionReason = 'Insufficient open capacity in one or more requested weeks';
    }

    // Experience from time entries
    const empEntries = input.entries.filter((e) => e.employee_name === emp.employeeName);
    let phaseHours = 0;
    let phaseHoursRecent = 0;
    let typeHours = 0;
    let typeHoursRecent = 0;
    const projects = new Set<string>();
    for (const e of empEntries) {
      const hrs = Number(e.actual_hours) || 0;
      const phase = (e.phase_name || e.phase || '').toLowerCase();
      const recent = e.work_date >= yearAgo;
      if (phase.includes(req.phase.toLowerCase()) || req.phase.toLowerCase().includes(phase)) {
        phaseHours += hrs;
        if (recent) phaseHoursRecent += hrs;
      }
      // project type not on TE — approximate via parent name keywords if provided
      if (req.projectType) {
        const blob = `${e.parent_project_name || ''} ${e.project_name || ''}`.toLowerCase();
        if (blob.includes(req.projectType.toLowerCase())) {
          typeHours += hrs;
          if (recent) typeHoursRecent += hrs;
        }
      }
      if (e.parent_project_name || e.project_name) {
        projects.add(e.parent_project_name || e.project_name || '');
      }
    }

    const expScore = clamp01(
      (phaseHoursRecent * 1.5 + phaseHours * 0.5 + typeHoursRecent * 1.2 + typeHours * 0.4) /
        Math.max(req.hoursPerWeek * duration * 4, 40),
    );

    // Continuity
    let continuity = 0.5;
    const continuityNotes: string[] = [];
    if (
      emp.activePhases.some(
        (p) =>
          (req.projectName && p.projectName === req.projectName) ||
          (req.projectId && p.projectName === req.projectId),
      )
    ) {
      continuity = 1;
      continuityNotes.push('already allocated/working on this project');
    } else if (req.preferredPmOrTeam) {
      const pref = req.preferredPmOrTeam.toLowerCase();
      if (
        (emp.discipline || '').toLowerCase().includes(pref) ||
        (emp.role || '').toLowerCase().includes(pref) ||
        emp.employeeName.toLowerCase().includes(pref)
      ) {
        continuity = 0.8;
        continuityNotes.push('matches preferred PM/team');
      }
    } else {
      continuityNotes.push('neutral continuity (no prior project/team signal)');
    }

    // Capacity fit: enough room every week and stays near target after add
    const minOpenBefore = Math.min(
      ...requestedWeeks.map((w) => {
        const base = emp.weeks.find((x) => x.weekStart === w);
        return base ? base.openCapacity : emp.weeklyCapacity;
      }),
    );
    const capacityFit = clamp01(
      anyOver ? 0.15 : minOpenBefore >= req.hoursPerWeek ? 0.55 + 0.45 * clamp01(minOpenBefore / (req.hoursPerWeek * 2)) : 0.25,
    );

    const stability = clamp01(
      1 - Math.min(emp.activePhaseCount, 8) / 8 + (anyOver ? -0.3 : 0.1),
    );

    const scores: MatchScoreBreakdown = {
      capacityFit,
      relevantExperience: expScore,
      continuity,
      workloadStability: stability,
      total:
        capacityFit * 0.5 + expScore * 0.3 + continuity * 0.15 + stability * 0.05,
    };

    const openThisWeek = emp.openCapacityThisWeek;
    const projected =
      emp.weeklyCapacity > 0
        ? (emp.plannedThisWeek + req.hoursPerWeek) / emp.weeklyCapacity
        : 0;

    const explanationParts = [
      `${emp.employeeName} has ${openThisWeek.toFixed(1)}h open this week` +
        ` (lowest open during request: ${lowestOpen.toFixed(1)}h).`,
      `Projected utilization after assignment: ${(projected * 100).toFixed(0)}% (${workloadStatus(projected)}).`,
      expScore > 0.2
        ? `Relevant experience: ${phaseHoursRecent.toFixed(0)}h in ${req.phase} (past 12 mo)` +
          (req.projectType ? `, ${typeHoursRecent.toFixed(0)}h related to ${req.projectType}` : '') +
          ` across ${projects.size} projects.`
        : req.projectType
          ? `Limited typed experience in ${req.phase}/${req.projectType}; ranking leans on capacity and continuity.`
          : `Limited phase-hour history for ${req.phase}; ranking leans on capacity and continuity.`,
      `Continuity: ${continuityNotes.join('; ')}.`,
    ];

    all.push({
      employeeName: emp.employeeName,
      eligible,
      exclusionReason,
      openThisWeek,
      lowestOpenDuring: lowestOpen,
      projectedUtilization: projected,
      activePhaseCount: emp.activePhaseCount,
      comparablePhaseHours: phaseHoursRecent,
      comparableTypeHours: typeHoursRecent,
      comparableProjectCount: projects.size,
      scores,
      explanation: explanationParts.join(' '),
      conflicts: [...new Set(conflicts)],
      weekPreview,
    });
  }

  const recommended = all
    .filter((c) => c.eligible)
    .sort(
      (a, b) =>
        b.scores.total - a.scores.total ||
        b.lowestOpenDuring - a.lowestOpenDuring ||
        a.employeeName.localeCompare(b.employeeName),
    )
    .slice(0, 3);

  const excluded = all
    .filter((c) => !c.eligible)
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  // Constrained options: show top excluded-by-capacity with warnings
  if (req.showConstrained) {
    const constrained = all
      .filter((c) => !c.eligible && /capacity|PTO|over/i.test(c.exclusionReason || ''))
      .sort((a, b) => b.scores.total - a.scores.total)
      .slice(0, 3)
      .map((c) => ({ ...c, eligible: true, exclusionReason: null }));
    for (const c of constrained) {
      if (!recommended.find((r) => r.employeeName === c.employeeName)) {
        recommended.push(c);
      }
    }
  }

  return { recommended: recommended.slice(0, 3), excluded };
}
