/**
 * Central delivery / non-delivery classification for staffing workload.
 * Billable time is delivery by default. Explicit non-delivery activities
 * (PTO, holiday, lunch, sick, etc.) are excluded from delivery hours.
 */

/** Clear non-work even if miscoded as billable. */
const PTO_LIKE_PATTERNS: RegExp[] = [
  /\bpto\b/,
  /\bvacation\b/,
  /\bholiday\b/,
  /\bsick\b/,
  /\blunch\b/,
  /\btime\s*off\b/,
  /\bbereavement\b/,
  /\bjury\b/,
];

/** Non-delivery only applied when the entry is not billable. */
const NB_NON_DELIVERY_PATTERNS: RegExp[] = [
  ...PTO_LIKE_PATTERNS,
  /\bpersonal\b/,
  /\btraining\b(?!\s*on\s*project)/,
  /\binternal\s*meeting\b/,
  /\boffice\s*admin\b/,
  /^administration:?$/,
  /^admin:?$/,
  /^clerical:?$/,
];

export type DeliveryClass = 'delivery' | 'non_delivery' | 'uncertain_project_nb';

export function classifyDeliveryHours(input: {
  isBillable: boolean;
  isWrittenOff?: boolean;
  isExtra?: boolean;
  activity?: string | null;
  projectName?: string | null;
  phase?: string | null;
}): DeliveryClass {
  if (input.isWrittenOff) return 'non_delivery';
  const activity = (input.activity || '').trim().toLowerCase();
  const text = `${activity} ${input.projectName || ''} ${input.phase || ''}`.toLowerCase();
  if (PTO_LIKE_PATTERNS.some((re) => re.test(text))) return 'non_delivery';
  // Billable project time is delivery — do not drop for loose "admin" substring matches.
  if (input.isBillable) return 'delivery';
  if (NB_NON_DELIVERY_PATTERNS.some((re) => re.test(activity) || re.test(text))) {
    return 'non_delivery';
  }
  // Non-billable but looks project-tied — surface separately
  if ((input.projectName || input.phase) && !/internal\s*office/i.test(text)) {
    return 'uncertain_project_nb';
  }
  return 'non_delivery';
}

export function isDeliveryHours(input: {
  isBillable: boolean;
  isWrittenOff?: boolean;
  isExtra?: boolean;
  activity?: string | null;
  projectName?: string | null;
  phase?: string | null;
}): boolean {
  return classifyDeliveryHours(input) === 'delivery';
}

/** Bucket activity labels for the trailing activity breakdown. */
export function activityBucket(activity: string | null | undefined): string {
  const a = (activity || '').trim().toLowerCase();
  if (!a) return 'Unspecified';
  if (/draft/.test(a)) return 'Drafting';
  if (/design|schematic|sd\b|dd\b|cd\b/.test(a)) return 'Design';
  if (/consultant|engineer|coordination with/.test(a)) return 'Consultant coordination';
  if (/project\s*coord|pm\b|management/.test(a)) return 'Project coordination';
  if (/construction|ca\b|site|rfi|submittal/.test(a)) return 'Construction coordination';
  if (/meeting|call|client/.test(a)) return 'Meetings / client';
  if (/admin|email|filing/.test(a)) return 'Admin';
  return activity!.trim();
}

export type WorkloadStatus = 'available' | 'near_capacity' | 'at_capacity' | 'over_capacity';

export const WORKLOAD_THRESHOLDS = {
  availableBelow: 0.8,
  nearBelow: 0.95,
  atBelow: 1.0,
} as const;

export function workloadStatus(deliveryUtilization: number): WorkloadStatus {
  if (deliveryUtilization > WORKLOAD_THRESHOLDS.atBelow) return 'over_capacity';
  if (deliveryUtilization >= WORKLOAD_THRESHOLDS.nearBelow) return 'at_capacity';
  if (deliveryUtilization >= WORKLOAD_THRESHOLDS.availableBelow) return 'near_capacity';
  return 'available';
}

export function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay(); // 0 Sun
  const diff = day === 0 ? -6 : 1 - day;
  x.setUTCDate(x.getUTCDate() + diff);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

export function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function weekStarts(from: Date, weeks: number): string[] {
  const start = mondayOf(from);
  const out: string[] = [];
  for (let i = 0; i < weeks; i += 1) {
    out.push(ymd(addDays(start, i * 7)));
  }
  return out;
}

export function daysAgoYmd(n: number, now = new Date()): string {
  return ymd(addDays(now, -n));
}
