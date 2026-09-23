import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildEmployeeRoster,
  DEFAULT_EMPLOYEE_ROSTER,
  compareTeamName,
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

describe('compareTeamName', () => {
  it('orders US Team before Pak Team', () => {
    assert.equal(compareTeamName('US Team', 'Pak Team') < 0, true);
  });
});
