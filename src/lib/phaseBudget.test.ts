import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildProjectPhaseBudgetBars,
  budgetBurnFillColor,
  maxPhaseBudgetPctForManager,
  phaseBudgetPct,
} from './phaseBudget';
import type { ProjectRow } from './types';

function phaseRow(partial: Partial<ProjectRow> & { project: string }): ProjectRow {
  return {
    client: 'C',
    city: null,
    manager: null,
    status: 'ACTIVE',
    type: null,
    phase: null,
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
    ...partial,
  };
}

describe('phaseBudgetPct', () => {
  it('uses pct_used when set', () => {
    const row = phaseRow({ project: 'P', contract: 1000, spent: 400, pct_used: 0.55 });
    assert.equal(phaseBudgetPct(row), 0.55);
  });

  it('derives from spent and contract', () => {
    const row = phaseRow({ project: 'P', contract: 200, spent: 50 });
    assert.equal(phaseBudgetPct(row), 0.25);
  });

  it('returns null without contract', () => {
    assert.equal(phaseBudgetPct(phaseRow({ project: 'P', contract: 0, spent: 10 })), null);
  });
});

describe('buildProjectPhaseBudgetBars', () => {
  it('shows all phases for project lead', () => {
    const bars = buildProjectPhaseBudgetBars({
      project: {
        key: 'k',
        row: null,
        phases: [
          { label: 'SD', row: phaseRow({ project: 'a', contract: 100, spent: 40, manager: 'A' }) },
          { label: 'DD', row: phaseRow({ project: 'b', contract: 100, spent: 90, manager: 'B' }) },
        ],
      },
      employeeName: 'Lead',
      viewAllPhases: true,
    });
    assert.equal(bars.length, 2);
    assert.equal(bars[0]!.label, 'DD');
    assert.equal(bars[0]!.pct, 0.9);
  });

  it('filters to managed phases for phase lead', () => {
    const bars = buildProjectPhaseBudgetBars({
      project: {
        key: 'k',
        row: null,
        phases: [
          { label: 'SD', row: phaseRow({ project: 'a', contract: 100, spent: 40, manager: 'Pat' }) },
          { label: 'DD', row: phaseRow({ project: 'b', contract: 100, spent: 90, manager: 'Other' }) },
        ],
      },
      employeeName: 'Pat',
      viewAllPhases: false,
    });
    assert.equal(bars.length, 1);
    assert.equal(bars[0]!.label, 'SD');
    assert.equal(bars[0]!.isYours, true);
  });
});

describe('maxPhaseBudgetPctForManager', () => {
  it('picks the highest pct among managed phases', () => {
    const phases = [
      { label: 'A', row: phaseRow({ project: 'a', contract: 100, spent: 30, manager: 'X' }) },
      { label: 'B', row: phaseRow({ project: 'b', contract: 100, spent: 95, manager: 'X' }) },
    ];
    assert.equal(maxPhaseBudgetPctForManager(phases, 'x'), 0.95);
  });
});

describe('budgetBurnFillColor', () => {
  it('flags over budget on active phases', () => {
    assert.equal(budgetBurnFillColor(1.05, false), '#E8A8A4');
  });
});
