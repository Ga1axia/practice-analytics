import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildEfficiencyAnalysis,
  classifyNbHours,
  companyMonthlyFromTimeEntries,
  networkDaysInMonth,
  pickEfficiencyMonth,
  type EfficiencyTimeRow,
} from './efficiencyAnalysis';

function row(
  partial: Partial<EfficiencyTimeRow> & Pick<EfficiencyTimeRow, 'work_date' | 'actual_hours'>,
): EfficiencyTimeRow {
  return {
    is_billable: false,
    employee_name: 'Ada',
    ...partial,
  };
}

describe('classifyNbHours', () => {
  it('buckets PTO, MBD, client NB, and probono', () => {
    assert.equal(classifyNbHours('Internal Office', 'PTO'), 'ptoSick');
    assert.equal(classifyNbHours('Marketing', 'Business development'), 'mbd');
    assert.equal(classifyNbHours('Potential client', 'Client interaction'), 'clientNb');
    assert.equal(classifyNbHours('Pro Bono Clinic', 'Design'), 'probono');
    assert.equal(classifyNbHours('22-004 Residence', 'Coordination'), 'others');
  });
});

describe('companyMonthlyFromTimeEntries', () => {
  it('splits billable vs NB and fills Power BI buckets', () => {
    const monthly = companyMonthlyFromTimeEntries([
      row({ work_date: '2026-07-02', actual_hours: 8, is_billable: true, employee_name: 'Ada' }),
      row({ work_date: '2026-07-03', actual_hours: 8, is_billable: true, employee_name: 'Ben' }),
      row({
        work_date: '2026-07-06',
        actual_hours: 4,
        project_name: 'Internal Office',
        activity: 'PTO',
      }),
      row({
        work_date: '2026-07-07',
        actual_hours: 2,
        project_name: 'MBD',
        activity: 'Proposal',
      }),
      row({
        work_date: '2026-07-08',
        actual_hours: 1.25,
        activity: 'Client hrs NB',
      }),
      row({
        work_date: '2026-07-09',
        actual_hours: 3,
        project_name: 'Overhead',
        activity: 'Admin',
      }),
    ]);

    assert.equal(monthly.length, 1);
    const jul = monthly[0]!;
    assert.equal(jul.month, '2026-07');
    assert.equal(jul.bill_hours, 16);
    assert.equal(jul.nb_hours, 10.25);
    assert.equal(jul.total_hours, 26.25);
    assert.equal(jul.pto_sick_hours, 4);
    assert.equal(jul.mbd_hours, 2);
    assert.equal(jul.client_nb_hours, 1.25);
    assert.equal(jul.others_nb_hours, 3);
    assert.equal(jul.probono_hours, 0);

    const weekdays = networkDaysInMonth('2026-07');
    assert.equal(jul.capacity_hours, weekdays * 8 * 2);
    assert.equal(jul.standard_hours, jul.capacity_hours! - 4);
  });

  it('treats written-off and extra hours as non-billable', () => {
    const monthly = companyMonthlyFromTimeEntries([
      row({ work_date: '2026-07-02', actual_hours: 8, is_billable: true, is_written_off: true }),
      row({ work_date: '2026-07-03', actual_hours: 2, is_billable: true, is_extra: true }),
    ]);
    assert.equal(monthly[0]!.bill_hours, 0);
    assert.equal(monthly[0]!.nb_hours, 10);
  });
});

describe('pickEfficiencyMonth', () => {
  const now = new Date(2026, 7, 26); // Aug 26, 2026

  it('keeps an in-progress month from replacing last complete month', () => {
    const picked = pickEfficiencyMonth(
      [
        { month: '2026-07', bill_hours: 2500, nb_hours: 1100, total_hours: 3600, standard_hours: 3200, efficiency: 0.78 },
        { month: '2026-08', bill_hours: 1200, nb_hours: 700, total_hours: 1900, standard_hours: 3500, efficiency: 0.34 },
      ],
      now,
    );
    assert.equal(picked?.month, '2026-07');
  });

  it('uses the current month once hours are substantially complete', () => {
    const picked = pickEfficiencyMonth(
      [
        { month: '2026-07', bill_hours: 2500, nb_hours: 1100, total_hours: 3600, standard_hours: 3200, efficiency: 0.78 },
        { month: '2026-08', bill_hours: 2500, nb_hours: 1100, total_hours: 3600, standard_hours: 3200, efficiency: 0.78 },
      ],
      now,
    );
    assert.equal(picked?.month, '2026-08');
  });
});

describe('buildEfficiencyAnalysis', () => {
  it('computes bill/std efficiency and donut shares from live monthly rows', () => {
    const analysis = buildEfficiencyAnalysis(
      [
        {
          month: '2026-07',
          bill_hours: 2524.25,
          nb_hours: 1172.25,
          total_hours: 3696.5,
          standard_hours: 3286,
          efficiency: 0,
          client_nb_hours: 48.25,
          mbd_hours: 107.25,
          pto_sick_hours: 210,
          others_nb_hours: 797.25,
          probono_hours: 9.5,
        },
      ],
      new Date(2026, 7, 26),
    );
    assert.ok(analysis);
    assert.equal(analysis!.monthLabel, 'Jul-2026');
    assert.equal(analysis!.billHours, 2524.25);
    assert.ok(Math.abs(analysis!.efficiency - 2524.25 / 3286) < 1e-9);
    assert.equal(analysis!.breakdown.ptoSick, 210);
  });
});
