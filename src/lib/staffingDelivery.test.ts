import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bqeRetryDelayMs,
} from '../../api/_lib/bqe';
import {
  mapBqeTimeEntryToRow,
  sanitizeTimeEntryPayload,
} from '../../api/_lib/bqeTimeEntrySync';
import {
  classifyDeliveryHours,
  isDeliveryHours,
  workloadStatus,
  weekStarts,
} from './staffingDelivery';
import { rankStaffingMatches } from './staffingMatch';
import { aggregateStaffingBoard, buildWeekSlice } from './staffingAggregate';
import type { EmployeeWorkloadRow, TimeEntryLite } from './staffingTypes';

describe('delivery classification', () => {
  it('treats billable as delivery', () => {
    assert.equal(
      classifyDeliveryHours({ isBillable: true, activity: 'Drafting' }),
      'delivery',
    );
  });

  it('excludes PTO / lunch from delivery', () => {
    assert.equal(
      classifyDeliveryHours({ isBillable: false, activity: 'PTO' }),
      'non_delivery',
    );
    assert.equal(
      isDeliveryHours({ isBillable: true, activity: 'Sick leave' }),
      false,
    );
  });

  it('keeps billable drafting/design as delivery', () => {
    assert.equal(
      classifyDeliveryHours({ isBillable: true, activity: 'Drafting:', projectName: 'Birla - CD' }),
      'delivery',
    );
    assert.equal(
      classifyDeliveryHours({ isBillable: true, activity: 'Administration:' }),
      'delivery',
    );
  });

  it('flags project NB as uncertain', () => {
    assert.equal(
      classifyDeliveryHours({
        isBillable: false,
        projectName: 'Birla Residence',
        phase: 'CD',
        activity: 'Internal review',
      }),
      'uncertain_project_nb',
    );
  });
});

describe('workload status + PTO', () => {
  it('marks over capacity above 100% delivery util', () => {
    assert.equal(workloadStatus(1.01), 'over_capacity');
    assert.equal(workloadStatus(0.95), 'at_capacity');
    assert.equal(workloadStatus(0.8), 'near_capacity');
    assert.equal(workloadStatus(0.79), 'available');
  });

  it('PTO reduces open capacity but not delivery utilization', () => {
    const slice = buildWeekSlice(32, 16, 8, '2026-08-10');
    assert.equal(slice.deliveryUtilization, 0.5);
    assert.equal(slice.openCapacity, 8);
    assert.equal(slice.timeOff, 8);
  });

  it('over capacity when planned + PTO exceeds capacity', () => {
    const slice = buildWeekSlice(32, 28, 8, '2026-08-10');
    assert.equal(slice.overCapacityHours, 4);
  });
});

describe('active project-phase definition', () => {
  it('includes phases with ≥2 delivery hours in trailing 14d', () => {
    const now = new Date('2026-08-11T12:00:00Z');
    const entries: TimeEntryLite[] = [
      {
        id: '1',
        bqe_time_entry_id: 'te1',
        employee_id: 'e1',
        employee_name: 'Ada',
        project_id: 'p1',
        project_name: 'Birla - CD',
        parent_project_name: 'Birla',
        phase: 'CD',
        phase_name: 'CD',
        client: 'Birla',
        activity_id: null,
        activity: 'Drafting',
        work_date: '2026-08-05',
        actual_hours: 3,
        is_billable: true,
        is_written_off: false,
        is_extra: false,
        description: null,
        memo: null,
      },
    ];
    const board = aggregateStaffingBoard({
      capacities: [
        {
          id: 'c1',
          employee_id: 'e1',
          employee_name: 'Ada',
          weekly_capacity_hours: 32,
          target_delivery_hours: null,
          active: true,
          role: 'Designer',
          discipline: 'US',
          skills: [],
          effective_from: null,
          effective_to: null,
        },
      ],
      rosterNames: ['Ada'],
      entries,
      allocations: [],
      timeOff: [],
      profiles: [],
      phases: [],
      filters: { trailingDays: 14, horizonWeeks: 4 },
      now,
    });
    assert.equal(board.employees[0]!.activePhaseCount, 1);
    assert.match(board.employees[0]!.currentlyWorkingOn, /Birla/);
  });

  it('no-allocation empty state leaves planned at zero', () => {
    const board = aggregateStaffingBoard({
      capacities: [
        {
          id: 'c1',
          employee_id: null,
          employee_name: 'Bea',
          weekly_capacity_hours: 32,
          target_delivery_hours: null,
          active: true,
          role: null,
          discipline: null,
          skills: [],
          effective_from: null,
          effective_to: null,
        },
      ],
      rosterNames: ['Bea'],
      entries: [],
      allocations: [],
      timeOff: [],
      profiles: [],
      phases: [],
      filters: { trailingDays: 14, horizonWeeks: 4 },
      now: new Date('2026-08-11T12:00:00Z'),
    });
    assert.equal(board.summary.hasAllocations, false);
    assert.equal(board.employees[0]!.plannedThisWeek, 0);
    assert.equal(board.employees[0]!.status, 'available');
  });
});

describe('time entry mapping / idempotency helpers', () => {
  it('strips billRate and costRate from payload', () => {
    const clean = sanitizeTimeEntryPayload({
      id: 'x',
      billRate: 200,
      costRate: 80,
      actualHours: 2,
    });
    assert.equal('billRate' in clean, false);
    assert.equal('costRate' in clean, false);
    assert.equal(clean.actualHours, 2);
  });

  it('maps BQE entry with phase lookup and skips missing id/date', () => {
    const lookup = new Map([
      [
        'pid',
        {
          parentName: 'Birla',
          phase: 'CD',
          phaseName: 'CD',
          projectName: 'Birla - CD',
        },
      ],
    ]);
    const row = mapBqeTimeEntryToRow(
      {
        id: 'te-1',
        date: '2026-08-01',
        projectId: 'pid',
        resource: 'Ada',
        resourceId: 'r1',
        actualHours: 4,
        billable: true,
        billRate: 999,
      },
      lookup,
    );
    assert.ok(row);
    assert.equal(row!.phase, 'CD');
    assert.equal(row!.parent_project_name, 'Birla');
    assert.equal((row!.raw_payload as { billRate?: number }).billRate, undefined);
    assert.equal(mapBqeTimeEntryToRow({ date: '2026-08-01' }, lookup), null);
  });
});

describe('429 backoff', () => {
  it('honors Retry-After seconds and exponential 5xx', () => {
    assert.equal(bqeRetryDelayMs(0, 429, '12', ''), 12_000);
    assert.equal(bqeRetryDelayMs(0, 429, null, 'try again in 40 seconds'), 40_000);
    assert.equal(bqeRetryDelayMs(2, 503, null, ''), 4000);
  });
});

describe('staffing match', () => {
  function emp(name: string, open: number, overrides: Partial<EmployeeWorkloadRow> = {}): EmployeeWorkloadRow {
    const weeks = weekStarts(new Date('2026-08-10T12:00:00Z'), 4).map((w) =>
      buildWeekSlice(32, 32 - open, 0, w),
    );
    return {
      employeeName: name,
      employeeId: null,
      role: 'Designer',
      discipline: 'US',
      active: true,
      weeklyCapacity: 32,
      trailing7Delivery: 10,
      trailing14Delivery: 20,
      trailing30Delivery: 40,
      currentWeeklyPace: 10,
      trailing30NonDelivery: 2,
      plannedThisWeek: 32 - open,
      timeOffThisWeek: 0,
      openCapacityThisWeek: open,
      plannedHorizon: (32 - open) * 4,
      openCapacityHorizon: open * 4,
      deliveryUtilizationThisWeek: (32 - open) / 32,
      status: workloadStatus((32 - open) / 32),
      activeProjectCount: 1,
      activePhaseCount: 2,
      activePhases: [],
      currentlyWorkingOn: '',
      weeks,
      dataQuality: {
        missingEmployee: 0,
        missingProject: 0,
        missingPhase: 0,
        allocationGap: false,
      },
      ...overrides,
    };
  }

  it('excludes role mismatch and insufficient capacity', () => {
    const result = rankStaffingMatches({
      request: {
        isNewProject: true,
        projectName: 'New Home',
        phase: 'CD',
        roleNeeded: 'Designer',
        hoursPerWeek: 20,
        startWeek: '2026-08-10',
        durationWeeks: 4,
      },
      employees: [
        emp('Full', 4, { role: 'Designer' }),
        emp('WrongRole', 24, { role: 'PM' }),
        emp('Open', 24, { role: 'Designer' }),
      ],
      capacities: [
        { employee_name: 'Full', role: 'Designer', discipline: 'US', skills: [], weekly_capacity_hours: 32, active: true },
        { employee_name: 'WrongRole', role: 'PM', discipline: 'US', skills: [], weekly_capacity_hours: 32, active: true },
        { employee_name: 'Open', role: 'Designer', discipline: 'US', skills: [], weekly_capacity_hours: 32, active: true },
      ],
      entries: [],
      now: new Date('2026-08-11T12:00:00Z'),
    });
    assert.ok(result.recommended.some((r) => r.employeeName === 'Open'));
    assert.ok(result.excluded.some((e) => e.employeeName === 'WrongRole'));
    assert.ok(result.excluded.some((e) => e.employeeName === 'Full'));
  });

  it('tie-breaks by score then open capacity', () => {
    const result = rankStaffingMatches({
      request: {
        isNewProject: true,
        phase: 'CD',
        hoursPerWeek: 8,
        startWeek: '2026-08-10',
        durationWeeks: 2,
      },
      employees: [emp('Zed', 20), emp('Amy', 20)],
      capacities: [
        { employee_name: 'Zed', role: null, discipline: null, skills: [], weekly_capacity_hours: 32, active: true },
        { employee_name: 'Amy', role: null, discipline: null, skills: [], weekly_capacity_hours: 32, active: true },
      ],
      entries: [],
      now: new Date('2026-08-11T12:00:00Z'),
    });
    assert.equal(result.recommended[0]!.employeeName, 'Amy');
  });

  it('flags PTO conflict weeks', () => {
    const e = emp('Pat', 24);
    e.weeks = e.weeks.map((w, i) =>
      i === 0 ? buildWeekSlice(32, 8, 8, w.weekStart) : w,
    );
    const result = rankStaffingMatches({
      request: {
        isNewProject: true,
        phase: 'DD',
        hoursPerWeek: 8,
        startWeek: '2026-08-10',
        durationWeeks: 2,
      },
      employees: [e],
      capacities: [
        { employee_name: 'Pat', role: null, discipline: null, skills: [], weekly_capacity_hours: 32, active: true },
      ],
      entries: [],
      now: new Date('2026-08-11T12:00:00Z'),
    });
    assert.ok(result.recommended[0]!.conflicts.some((c) => /PTO|time-off/i.test(c)));
  });
});
