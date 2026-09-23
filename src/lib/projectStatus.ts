/** Normalize CORE / DB project status for filters and display. */
export function normalizeProjectStatus(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === '') return 'UNKNOWN';
  const s = String(raw).trim().toUpperCase();
  if (s === 'ACTIVE' || s === 'ACTV') return 'ACTIVE';
  if (s === 'INACTIVE' || s === 'INACT') return 'INACTIVE';
  if (s === 'COMPLETED' || s === 'COMPLETE' || s === 'DONE' || s === 'COMP') {
    return 'COMPLETED';
  }
  if (s === 'CANCELED' || s === 'CANCELLED' || s === 'CANCEL') return 'CANCELED';
  if (s === 'DRAFT') return 'DRAFT';
  if (s === 'HOLD' || s === 'ON HOLD') return 'HOLD';
  if (s.includes('HOLD')) return 'HOLD';
  if (s.includes('DRAFT')) return 'DRAFT';
  if (s.includes('CANCEL')) return 'CANCELED';
  if (s.includes('INACTIVE')) return 'INACTIVE';
  if (s.includes('COMPLETE')) return 'COMPLETED';
  if (s.includes('ACTIVE')) return 'ACTIVE';
  return s;
}

/** Only CORE Active (status=0) — not draft, hold, completed, inactive, canceled, or unknown. */
export function isActiveProjectStatus(raw: string | null | undefined): boolean {
  return normalizeProjectStatus(raw) === 'ACTIVE';
}

export function isCompletedProjectStatus(raw: string | null | undefined): boolean {
  const s = normalizeProjectStatus(raw);
  return s === 'COMPLETED' || s === 'COMPLETE' || s === 'DONE';
}
