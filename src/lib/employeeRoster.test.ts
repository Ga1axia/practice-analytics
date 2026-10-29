import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildEmployeeRoster,
  canonicalEmployeeName,
  compareTeamName,
  DEFAULT_EMPLOYEE_ROSTER,
  employeeIdentityKey,
} from './employeeRoster';

describe('buildEmployeeRoster', () => {
  it('sorts US before Pak and names A–Z within team', () => {
    const roster = buildEmployeeRoster([
      { team: 'Pak Team', employee: 'Muhammad Junaid' },
      { team: 'US Team', employee: 'Zhengrui He' },
      { team: 'US Team', employee: 'Arnita Serri' },
    ]);
    assert.deepEqual(Object.keys(roster), ['US Team', 'Pak Team']);
    assert.deepEqual(roster['US Team'], ['Arnita Serri', 'Zhengrui He']);
  });

  it('includes full default seed list', () => {
    assert.equal(DEFAULT_EMPLOYEE_ROSTER.length, 20);
    const roster = buildEmployeeRoster(DEFAULT_EMPLOYEE_ROSTER);
    assert.equal(roster['US Team']?.length, 12);
    assert.equal(roster['Pak Team']?.length, 8);
  });
});

describe('employeeIdentityKey', () => {
  it('treats spaced, compacted, and BQE version spellings as one person', () => {
    const key = employeeIdentityKey('Avery Cobe');
    assert.equal(employeeIdentityKey('AveryCobe'), key);
    assert.equal(employeeIdentityKey('AVERY-V1 COBE'), key);
    assert.equal(employeeIdentityKey('AVERY-V1COBE'), key);
    assert.equal(employeeIdentityKey('NiNi'), employeeIdentityKey('Ni Ni'));
  });
});

describe('canonicalEmployeeName', () => {
  const roster = DEFAULT_EMPLOYEE_ROSTER.map((r) => r.employee);

  it('rewrites BQE manager spellings to the roster name', () => {
    assert.equal(canonicalEmployeeName('AveryCobe', roster), 'Avery Cobe');
    assert.equal(canonicalEmployeeName('AVERY-V1 COBE', roster), 'Avery Cobe');
    assert.equal(canonicalEmployeeName('NiNi', roster), 'Ni Ni');
    assert.equal(canonicalEmployeeName('  Someone Else  ', roster), 'Someone Else');
  });
});

describe('compareTeamName', () => {
  it('orders US Team before Pak Team', () => {
    assert.equal(compareTeamName('US Team', 'Pak Team') < 0, true);
  });
});
