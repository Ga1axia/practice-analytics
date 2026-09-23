import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProjectNode } from './projectListHierarchy';
import {
  collectClientOptions,
  collectMyPhaseOptions,
  matchesEmployeeProjectFilters,
} from './employeeProjectFilters';
import { compareEmployeeProjects, parseEmployeeProjectSort } from './employeeProjectSort';

function stubProject(
  partial: Partial<ProjectNode> & { key: string; title: string; clientName?: string },
): ProjectNode & { clientName: string } {
  return {
    key: partial.key,
    title: partial.title,
    code: partial.code ?? '',
    contract: partial.contract ?? 0,
    billed: 0,
    outstanding: 0,
    row: partial.row ?? null,
    phases: partial.phases ?? [],
    clientName: partial.clientName ?? 'Acme',
  };
}

describe('employee project filters', () => {
  it('collects phase labels managed by employee', () => {
    const projects = [
      stubProject({
        key: 'a',
        title: 'A',
        phases: [
          { label: 'SD', row: { manager: 'Pat', phase: 'SD', project: 'A' } as never },
          { label: 'CD', row: { manager: 'Other', phase: 'CD', project: 'A' } as never },
        ],
      }),
    ];
    assert.deepEqual(collectMyPhaseOptions(projects, 'Pat'), ['SD']);
  });

  it('filters lead vs member', () => {
    const pLead = stubProject({
      key: 'lead',
      title: 'Lead',
      row: { manager: 'Pat' } as never,
    });
    const pMember = stubProject({
      key: 'mem',
      title: 'Mem',
      row: { manager: 'Boss' } as never,
    });
    const roles = new Map([['mem', 'member' as const]]);
    assert.equal(
      matchesEmployeeProjectFilters(pLead, 'Pat', roles, { role: 'lead', phase: '', client: '' }),
      true,
    );
    assert.equal(
      matchesEmployeeProjectFilters(pMember, 'Pat', roles, { role: 'lead', phase: '', client: '' }),
      false,
    );
    assert.equal(
      matchesEmployeeProjectFilters(pMember, 'Pat', roles, { role: 'member', phase: '', client: '' }),
      true,
    );
  });

  it('filters by phase and client', () => {
    const p = stubProject({
      key: 'x',
      title: 'X',
      clientName: 'City Co',
      phases: [{ label: 'DD', row: { manager: 'Pat', phase: 'DD' } as never }],
    });
    const roles = new Map<string, never>();
    assert.equal(
      matchesEmployeeProjectFilters(p, 'Pat', roles, { role: 'all', phase: 'DD', client: '' }),
      true,
    );
    assert.equal(
      matchesEmployeeProjectFilters(p, 'Pat', roles, { role: 'all', phase: 'SD', client: '' }),
      false,
    );
    assert.equal(
      matchesEmployeeProjectFilters(p, 'Pat', roles, { role: 'all', phase: '', client: 'City Co' }),
      true,
    );
  });

  it('collects sorted client names', () => {
    const projects = [
      { ...stubProject({ key: 'b', title: 'B' }), clientName: 'Zeta' },
      { ...stubProject({ key: 'a', title: 'A' }), clientName: 'Alpha' },
    ];
    assert.deepEqual(collectClientOptions(projects), ['Alpha', 'Zeta']);
  });
});

describe('extended employee project sort', () => {
  it('parses new sort modes', () => {
    assert.equal(parseEmployeeProjectSort('lead_first'), 'lead_first');
    assert.equal(parseEmployeeProjectSort('contract'), 'contract');
    assert.equal(parseEmployeeProjectSort('client'), 'client');
  });

  it('sorts leads first then recent hours', () => {
    const last = new Map([
      ['mem', '2026-09-01'],
      ['lead', '2026-01-01'],
    ]);
    const isLead = (key: string) => key === 'lead';
    const rows = [
      { key: 'mem', title: 'Member', clientName: 'A', contract: 1 },
      { key: 'lead', title: 'Lead', clientName: 'A', contract: 1 },
    ];
    rows.sort((a, b) => compareEmployeeProjects(a, b, 'lead_first', last, isLead));
    assert.deepEqual(rows.map((r) => r.key), ['lead', 'mem']);
  });
});
