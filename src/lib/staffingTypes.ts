import type { WorkloadStatus } from './staffingDelivery';

export type TrailingWindowDays = 7 | 14 | 30;
export type PlanningHorizonWeeks = 4 | 8 | 12;

export type EmployeeCapacityRow = {
  id: string;
  employee_id: string | null;
  employee_name: string;
  weekly_capacity_hours: number;
  target_delivery_hours: number | null;
  active: boolean;
  role: string | null;
  discipline: string | null;
  skills: string[] | null;
  effective_from: string | null;
  effective_to: string | null;
};

export type ProjectStaffingProfile = {
  id: string;
  bqe_project_id: string | null;
  project_key: string | null;
  project_name: string;
  client: string | null;
  project_type: string | null;
  project_status: 'active' | 'paused' | 'completed';
  project_manager: string | null;
};

export type ProjectPhaseStaffing = {
  id: string;
  project_staffing_profile_id: string;
  bqe_phase_id: string | null;
  phase_key: string | null;
  phase_code: string | null;
  phase_name: string;
  status: 'active' | 'paused' | 'completed';
  target_completion_date: string | null;
};

export type PhaseAllocation = {
  id: string;
  employee_id: string | null;
  employee_name: string;
  project_staffing_profile_id: string;
  project_phase_staffing_id: string;
  week_start: string;
  planned_hours: number;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
};

export type TimeOffRow = {
  id: string;
  employee_id: string | null;
  employee_name: string;
  off_date: string;
  hours: number;
  type: 'pto' | 'holiday' | 'training' | 'other';
  notes: string | null;
};

export type TimeEntryLite = {
  id: string;
  bqe_time_entry_id: string;
  employee_id: string | null;
  employee_name: string | null;
  project_id: string | null;
  project_name: string | null;
  parent_project_name: string | null;
  phase: string | null;
  phase_name: string | null;
  client: string | null;
  activity_id: string | null;
  activity: string | null;
  work_date: string;
  actual_hours: number;
  is_billable: boolean;
  is_written_off: boolean;
  is_extra: boolean;
  description: string | null;
  memo: string | null;
};

export type ActivePhaseDetail = {
  projectName: string;
  parentProjectName: string | null;
  phase: string | null;
  client: string | null;
  trailingDeliveryHours: number;
  weeklyPace: number;
  plannedThisWeek: number;
  plannedHorizon: number;
  source: 'observed' | 'planned' | 'both';
};

export type WeekCapacitySlice = {
  weekStart: string;
  capacity: number;
  plannedDelivery: number;
  timeOff: number;
  openCapacity: number;
  deliveryUtilization: number;
  status: WorkloadStatus;
  overCapacityHours: number;
};

export type EmployeeWorkloadRow = {
  employeeName: string;
  employeeId: string | null;
  role: string | null;
  discipline: string | null;
  active: boolean;
  weeklyCapacity: number;
  trailing7Delivery: number;
  trailing14Delivery: number;
  trailing30Delivery: number;
  currentWeeklyPace: number;
  trailing30NonDelivery: number;
  plannedThisWeek: number;
  timeOffThisWeek: number;
  openCapacityThisWeek: number;
  plannedHorizon: number;
  openCapacityHorizon: number;
  deliveryUtilizationThisWeek: number;
  status: WorkloadStatus;
  activeProjectCount: number;
  activePhaseCount: number;
  activePhases: ActivePhaseDetail[];
  currentlyWorkingOn: string;
  weeks: WeekCapacitySlice[];
  dataQuality: {
    missingEmployee: number;
    missingProject: number;
    missingPhase: number;
    allocationGap: boolean;
  };
};

export type FirmStaffingSummary = {
  totalWeeklyCapacity: number;
  plannedDeliveryThisWeek: number;
  openDeliveryThisWeek: number;
  nearCapacityCount: number;
  overCapacityCount: number;
  activeEmployeePhaseAssignments: number;
  unallocatedCapacityHorizon: number;
  /** Rows loaded from pa_time_entries for the trailing window. */
  observedEntriesLoaded: number;
  /** Sum of trailing-window delivery hours (observed). */
  observedDeliveryHours: number;
  hasTimeEntries: boolean;
  hasAllocations: boolean;
  lastTimeEntrySyncAt: string | null;
  syncStale: boolean;
};

export type StaffingBoardFilters = {
  trailingDays: TrailingWindowDays;
  horizonWeeks: PlanningHorizonWeeks;
  role?: string;
  discipline?: string;
  employee?: string;
  projectType?: string;
  phase?: string;
};

export type StaffingBoardResult = {
  summary: FirmStaffingSummary;
  employees: EmployeeWorkloadRow[];
  weekStarts: string[];
  filterOptions: {
    roles: string[];
    disciplines: string[];
    employees: string[];
    projectTypes: string[];
    phases: string[];
  };
  loadedAt: string;
};

export type ActivityBreakdownRow = { activity: string; hours: number };

export type EmployeeWorkloadDetail = EmployeeWorkloadRow & {
  activityBreakdown30d: ActivityBreakdownRow[];
  recentEntries: TimeEntryLite[];
};

export type MatchRequest = {
  projectId?: string | null;
  projectName?: string;
  isNewProject: boolean;
  projectType?: string;
  phase: string;
  roleNeeded?: string;
  skills?: string[];
  hoursPerWeek: number;
  startWeek: string;
  durationWeeks: number;
  preferredPmOrTeam?: string;
  showConstrained?: boolean;
};

export type MatchScoreBreakdown = {
  capacityFit: number;
  relevantExperience: number;
  continuity: number;
  workloadStability: number;
  total: number;
};

export type MatchCandidate = {
  employeeName: string;
  eligible: boolean;
  exclusionReason: string | null;
  openThisWeek: number;
  lowestOpenDuring: number;
  projectedUtilization: number;
  activePhaseCount: number;
  comparablePhaseHours: number;
  comparableTypeHours: number;
  comparableProjectCount: number;
  scores: MatchScoreBreakdown;
  explanation: string;
  conflicts: string[];
  weekPreview: WeekCapacitySlice[];
};

export type MatchResult = {
  recommended: MatchCandidate[];
  excluded: MatchCandidate[];
};
