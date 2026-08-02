import type { ArClient, ProjectRow } from './types';

/** Detail rows only — never sum project headers with their phases (double-counts). */
export function receivableRows(rows: ProjectRow[]): ProjectRow[] {
  const phases = rows.filter((r) => r.row_kind === 'phase');
  if (phases.length) return phases;
  const projects = rows.filter((r) => r.row_kind === 'project');
  return projects.length ? projects : rows;
}

/**
 * Per-row outstanding / receivable.
 * `contract_outstanding` defaults to 0 in the DB after migration, so treat a bare 0
 * as unset when `ar` still holds the seed/export value.
 */
export function rowOutstanding(r: ProjectRow): number {
  const co = r.contract_outstanding;
  const ar = Number(r.ar) || 0;
  if (co == null || (co === 0 && ar !== 0)) return ar;
  return Number(co) || 0;
}

/** Sum of per-row outstanding (credits may be negative). */
export function sumContractOutstanding(rows: ProjectRow[]): number {
  return receivableRows(rows).reduce((a, r) => a + rowOutstanding(r), 0);
}

/** Sum of amounts owed to the firm (positive outstanding only). */
export function sumPositiveOutstanding(rows: ProjectRow[]): number {
  return receivableRows(rows).reduce((a, r) => a + Math.max(0, rowOutstanding(r)), 0);
}

/** Display receivable: prefer live A/R aging when client names match; else project list. */
export function sumAmountReceivable(
  rows: ProjectRow[],
  arClients?: ArClient[] | null,
): { amount: number; source: 'ar_aging' | 'contract_outstanding' } {
  const detail = receivableRows(rows);
  if (arClients?.length) {
    const clients = new Set(
      detail.map((r) => r.client).filter((c): c is string => !!c && c.trim().length > 0),
    );
    const matched = arClients.filter((c) => clients.has(c.client));
    // Only use aging when we actually matched clients with a non-zero total
    if (matched.length) {
      const amount = matched.reduce((a, c) => a + (c.balance || 0), 0);
      if (amount !== 0 || matched.some((c) => (c.balance || 0) !== 0)) {
        return { amount, source: 'ar_aging' };
      }
    }
  }
  return {
    amount: sumPositiveOutstanding(detail),
    source: 'contract_outstanding',
  };
}
