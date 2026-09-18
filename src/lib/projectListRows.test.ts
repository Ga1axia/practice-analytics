import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPlistTableRows, isPlistJobCodedRow } from './projectListRows';
import type { ProjectRow } from './types';

function row(partial: Partial<ProjectRow> & Pick<ProjectRow, 'project'>): ProjectRow {
  return {
    client: 'Client',
    city: null,
    manager: null,
    status: 'ACTIVE',
    type: null,
    phase: 'Other',
    contract: 0,
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
    ...partial,
  };
}

describe('isPlistJobCodedRow', () => {
  it('requires ##-### on project headers', () => {
    assert.equal(isPlistJobCodedRow(row({ project: 'Internal Admin' })), false);
    assert.equal(isPlistJobCodedRow(row({ project: 'Tower - 26-001' })), true);
  });

  it('shows phases only when parent header has a job code', () => {
    assert.equal(
      isPlistJobCodedRow(
        row({
          project: 'Tower - 26-001 - SD',
          row_kind: 'phase',
          parent_project: 'Tower - 26-001',
          phase: 'SD',
        }),
      ),
      true,
    );
    assert.equal(
      isPlistJobCodedRow(
        row({
          project: 'Marketing - SD',
          row_kind: 'phase',
          parent_project: 'Marketing',
          phase: 'SD',
        }),
      ),
      false,
    );
  });
});

describe('buildPlistTableRows', () => {
  it('drops rows without a coded project header', () => {
    const out = buildPlistTableRows([
      row({ project: 'No Code Job', sort_order: 1 }),
      row({ project: 'Coded - 26-002', sort_order: 2 }),
      row({
        project: 'Coded - 26-002 - DD',
        row_kind: 'phase',
        parent_project: 'Coded - 26-002',
        phase: 'DD',
        sort_order: 3,
      }),
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0]?.row.project, 'Coded - 26-002');
  });
});
