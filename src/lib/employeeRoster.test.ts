import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEmployeeRoster } from './employeeRoster';

describe('buildEmployeeRoster', () => {
  it('sorts teams and names and keeps only people with logged hours', () => {
    const roster = buildEmployeeRoster(
      [
        { team: 'US Team', employee: 'Zhengrui He' },
        { team: 'US Team', employee: 'Arnita Serri' },
        { team: 'US Team', employee: 'No Hours Person' },
        { team: 'Pak Team', employee: 'Muhammad Junaid' },
        { team: 'Pak Team', employee: 'Aiman Rehman' },
      ],
      [
        { employee: 'Zhengrui He', bill_hours: 10, nb_hours: 0, total_hours: 10, standard_hours: 160, efficiency: 0.06 },
        { employee: 'Arnita Serri', bill_hours: 5, nb_hours: 0, total_hours: 5, standard_hours: 160, efficiency: 0.03 },
        { employee: 'Aiman Rehman', bill_hours: 1, nb_hours: 0, total_hours: 1, standard_hours: 160, efficiency: 0.01 },
        { employee: 'Muhammad Junaid', bill_hours: 2, nb_hours: 0, total_hours: 2, standard_hours: 160, efficiency: 0.01 },
      ],
    );
    assert.deepEqual(Object.keys(roster), ['Pak Team', 'US Team']);
    assert.deepEqual(roster['US Team'], ['Arnita Serri', 'Zhengrui He']);
    assert.deepEqual(roster['Pak Team'], ['Aiman Rehman', 'Muhammad Junaid']);
    assert.equal(roster['US Team']?.includes('No Hours Person'), false);
  });
});
