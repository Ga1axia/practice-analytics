import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compareEmployeeProjects,
  compareProjectsByRecentHours,
  parseEmployeeProjectSort,
  projectSortStorageKey,
} from './employeeProjectSort';

describe('employee project sort preference', () => {
  it('defaults unknown values to recent hours', () => {
    assert.equal(parseEmployeeProjectSort(null), 'recent');
    assert.equal(parseEmployeeProjectSort('name'), 'name');
    assert.equal(parseEmployeeProjectSort('recent'), 'recent');
    assert.equal(parseEmployeeProjectSort('nope'), 'recent');
  });

  it('keys storage per employee', () => {
    assert.equal(projectSortStorageKey(' Avery Cobe '), 'pa-emp-project-sort-v1:avery cobe');
  });
});

describe('compareProjectsByRecentHours', () => {
  it('sorts by most recent hours, then title; no hours last', () => {
    const last = new Map([
      ['recent', '2026-09-17'],
      ['older', '2026-01-02'],
    ]);
    const rows = [
      { key: 'never', title: 'Alpha' },
      { key: 'older', title: 'Zulu' },
      { key: 'recent', title: 'Mid' },
      { key: 'also-old', title: 'Beta' },
    ];
    rows.sort((a, b) => compareProjectsByRecentHours(a, b, last));
    assert.deepEqual(
      rows.map((r) => r.key),
      ['recent', 'older', 'never', 'also-old'],
    );
  });

  it('breaks same-day ties by title', () => {
    const last = new Map([
      ['b', '2026-09-01'],
      ['a', '2026-09-01'],
    ]);
    const rows = [
      { key: 'b', title: 'Birla' },
      { key: 'a', title: 'Ames' },
    ];
    rows.sort((a, b) => compareProjectsByRecentHours(a, b, last));
    assert.deepEqual(
      rows.map((r) => r.title),
      ['Ames', 'Birla'],
    );
  });

  it('name sort ignores hours dates', () => {
    const last = new Map([['z', '2026-09-17']]);
    const rows = [
      { key: 'z', title: 'Zulu' },
      { key: 'a', title: 'Alpha' },
    ];
    rows.sort((a, b) => compareEmployeeProjects(a, b, 'name', last));
    assert.deepEqual(
      rows.map((r) => r.title),
      ['Alpha', 'Zulu'],
    );
  });
});
