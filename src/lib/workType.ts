/** Design / scope categories for workload (not contract FIXED/HOURLY). */
export type WorkType = 'New' | 'Remodel' | 'ADU' | 'Interior' | 'Commercial';

export const WORK_TYPES: WorkType[] = ['New', 'Remodel', 'ADU', 'Interior', 'Commercial'];

export const WORK_TYPE_COLORS: Record<WorkType, string> = {
  New: '#146C6B',
  Remodel: '#A8783A',
  ADU: '#6B4C8A',
  Interior: '#3A6EA5',
  Commercial: '#8B6B8A',
};

/** Map legacy / alias labels onto the five firm types. */
function normalizeExplicit(ex: string): WorkType | null {
  const u = ex.trim().toUpperCase();
  if (!u) return null;
  // Contract-type enums stored in Project List `type` — ignore.
  if (/^(FIXED|HOURLY|HNTE|MARKETING|N\/A|OVERHEAD|UNKNOWN)$/i.test(u)) return null;

  if (/ADU|ACCESSORY\s*DWELLING|CASITA|GUEST\s*HOUSE/.test(u)) return 'ADU';
  if (/INTERIOR|\bID\b/.test(u)) return 'Interior';
  if (/REMODEL|RENOVAT|REHAB|ADDITION|ADD[\s-]?ON/.test(u)) return 'Remodel';
  if (/COMMERCIAL|OFFICE|RETAIL|MIXED[\s-]?USE|MULTI[\s-]?FAMILY|DUPLEX|TOWNHOME|CONDO/.test(u)) {
    return 'Commercial';
  }
  if (/^NEW\b|NEW\s*(CONSTRUCT|HOME|BUILD|HOUSE|RESIDENCE|SINGLE)|CUSTOM\s+HOME|\bSFR\b/.test(u)) {
    return 'New';
  }

  const hit = WORK_TYPES.find(
    (w) => w.toLowerCase() === ex.trim().toLowerCase() || u.includes(w.toUpperCase()),
  );
  return hit || null;
}

/**
 * Classify from explicit field or project / client name cues.
 * Order matters: ADU → Interior → Remodel → Commercial before the New/residence catch-all.
 */
export function classifyWorkType(
  name: string | null | undefined,
  explicit?: string | null,
): WorkType {
  const fromExplicit = normalizeExplicit(explicit || '');
  if (fromExplicit) return fromExplicit;

  const n = String(name || '').toLowerCase();

  // ADU before residence/home (e.g. "Smith ADU", "guest house")
  if (
    /\badu\b|a\.d\.u\.?|accessory\s*dwelling|guest\s*house|casita\b/.test(n)
  ) {
    return 'ADU';
  }

  // Interior design — match ID as a phase/token, not random substrings
  if (
    /\binteriors?\b|\binterior\s*design\b|(?:^|[\s\-–—/|(])id(?:$|[\s\-–—/|)])|\bid\s*design\b/.test(
      n,
    )
  ) {
    return 'Interior';
  }

  // Remodel / renovation / addition (addition rolls into Remodel)
  if (/\bremodels?\b|\brenovat|\brehab\b|\badditions?\b|\badd[\s-]?ons?\b/.test(n)) {
    return 'Remodel';
  }

  if (
    /\bcommercial\b|\boffice\b|\bretail\b|\bmixed[\s-]?use\b|\bmulti[\s-]?family\b|\bduplex\b|\btownhomes?\b|\btownhouses?\b|\bcondos?\b/.test(
      n,
    )
  ) {
    return 'Commercial';
  }

  if (
    /\bnew\s*(construct|home|build|house|residence|single)\b|\bcustom\s+home\b|\bsfr\b/.test(n)
  ) {
    return 'New';
  }

  // Firm Project List often uses "X Residence" without "New"
  if (/\bresidence\b|\bhouse\b|\bhome\b/.test(n)) return 'New';

  return 'New';
}
