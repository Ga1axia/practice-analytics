import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  activeCoreProjectIds,
  filterInvoicesForActiveProjects,
  type MappedProjects,
  type ProjectInsert,
} from './bqeSyncBuild.js';

function mappedFixture(): MappedProjects {
  const rows: ProjectInsert[] = [
    {
      project: 'Tower - 26-001',
      client: 'Acme',
      city: null,
      manager: 'PM',
      status: 'ACTIVE',
      type: 'FIXED',
      phase: 'Other',
      contract: 100,
      spent: 0,
      billed: 0,
      pct_used: null,
      pct_billed: null,
      retainer_paid: 0,
      retainer_balance: 0,
      ar: 0,
      profit: 0,
      margin: null,
      row_kind: 'project',
      parent_project: null,
      billed_hours: 0,
      spent_hours: 0,
      contract_outstanding: 0,
      sort_order: 0,
    },
    {
      project: 'Tower - 26-001 - SD',
      client: 'Acme',
      city: null,
      manager: 'PM',
      status: 'COMPLETED',
      type: 'FIXED',
      phase: 'SD',
      contract: 40,
      spent: 0,
      billed: 0,
      pct_used: null,
      pct_billed: null,
      retainer_paid: 0,
      retainer_balance: 0,
      ar: 0,
      profit: 0,
      margin: null,
      row_kind: 'phase',
      parent_project: 'Tower - 26-001',
      billed_hours: 0,
      spent_hours: 0,
      contract_outstanding: 0,
      sort_order: 1,
    },
    {
      project: 'Old Job - 20-010',
      client: 'Beta',
      city: null,
      manager: 'PM',
      status: 'INACTIVE',
      type: 'FIXED',
      phase: 'Other',
      contract: 50,
      spent: 0,
      billed: 0,
      pct_used: null,
      pct_billed: null,
      retainer_paid: 0,
      retainer_balance: 0,
      ar: 0,
      profit: 0,
      margin: null,
      row_kind: 'project',
      parent_project: null,
      billed_hours: 0,
      spent_hours: 0,
      contract_outstanding: 0,
      sort_order: 2,
    },
  ];
  const idToKey = new Map<string, string>([
    ['core-active', 'Tower - 26-001'],
    ['core-phase', 'Tower - 26-001 - SD'],
    ['core-inactive', 'Old Job - 20-010'],
  ]);
  return {
    rows,
    idToKey,
    idToParentId: new Map(),
    idToCreatedOn: new Map(),
    excludedIds: new Set(),
    excludedCount: 0,
  };
}

describe('activeCoreProjectIds', () => {
  it('includes active headers and their phases, not inactive projects', () => {
    const ids = activeCoreProjectIds(mappedFixture());
    assert.equal(ids.has('core-active'), true);
    assert.equal(ids.has('core-phase'), true);
    assert.equal(ids.has('core-inactive'), false);
  });
});

describe('filterInvoicesForActiveProjects', () => {
  it('keeps invoices with lines on active projects regardless of date', () => {
    const mapped = mappedFixture();
    const kept = filterInvoicesForActiveProjects(
      [
        {
          date: '2019-01-15',
          invoiceAmount: 1000,
          balance: 500,
          invoiceDetails: [{ projectId: 'core-phase', amount: 1000 }],
        },
        {
          date: '2024-06-01',
          invoiceAmount: 200,
          balance: 0,
          invoiceDetails: [{ projectId: 'core-inactive', amount: 200 }],
        },
      ],
      mapped,
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.balance, 500);
  });
});
