/** Design / scope categories for workload (not contract FIXED/HOURLY). */
export type WorkType =
  | 'New'
  | 'Interior'
  | 'Remodel'
  | 'ADU'
  | 'Addition'
  | 'Multi-family'
  | 'Commercial'
  | 'Other';

export const WORK_TYPES: WorkType[] = [
  'New',
  'Interior',
  'Remodel',
  'ADU',
  'Addition',
  'Multi-family',
  'Commercial',
  'Other',
];

export const WORK_TYPE_COLORS: Record<WorkType, string> = {
  New: '#146C6B',
  Interior: '#3A6EA5',
  Remodel: '#A8783A',
  ADU: '#6B4C8A',
  Addition: '#C47A5A',
  'Multi-family': '#2F4F7A',
  Commercial: '#8B6B8A',
  Other: '#9AA8B5',
};

/** Classify from explicit field or project / client name cues. */
export function classifyWorkType(
  name: string | null | undefined,
  explicit?: string | null,
): WorkType {
  const ex = (explicit || '').trim();
  if (ex) {
    const u = ex.toUpperCase();
    // Ignore contract-type enums stored in `type`
    if (!/^(FIXED|HOURLY|HNTE|MARKETING|N\/A|OVERHEAD|UNKNOWN)$/i.test(u)) {
      const hit = WORK_TYPES.find(
        (w) => w.toLowerCase() === ex.toLowerCase() || u.includes(w.toUpperCase()),
      );
      if (hit) return hit;
    }
  }

  const n = String(name || '').toLowerCase();
  if (/\badu\b|accessory\s*dwelling/.test(n)) return 'ADU';
  if (/\binterior\b|\bid\b/.test(n)) return 'Interior';
  if (/\bremodel|\brenovat|\brehab\b/.test(n)) return 'Remodel';
  if (/\baddition\b|\badd[\s-]?on\b/.test(n)) return 'Addition';
  if (/\bmulti[\s-]?family\b|\bduplex\b|\btownhome|\btownhouse|\bcondo\b/.test(n)) {
    return 'Multi-family';
  }
  if (/\bcommercial\b|\boffice\b|\bretail\b|\bmixed[\s-]?use\b/.test(n)) return 'Commercial';
  if (
    /\bnew\s*(construct|home|build|house|residence|single)\b|\bcustom\s+home\b|\bsfr\b/.test(n)
  ) {
    return 'New';
  }
  // Firm Project List often uses "X Residence" without "New" — treat as new residence.
  if (/\bresidence\b|\bhouse\b|\bhome\b/.test(n)) return 'New';
  return 'Other';
}
