/** Short phase codes used in the Main Report table (Power BI style). */
const RULES: { re: RegExp; code: string }[] = [
  { re: /reimbursable/i, code: 'RS' },
  { re: /additional\s*service/i, code: 'AS' },
  { re: /interior/i, code: 'ID' },
  { re: /construction\s*support|construction\s*admin|\bca\b/i, code: 'CST' },
  { re: /contractor\s*selection/i, code: 'CS' },
  { re: /construction\s*document/i, code: 'CD' },
  { re: /design\s*development|designs\s*development/i, code: 'DD' },
  { re: /planning/i, code: 'PP' },
  { re: /schematic|conceptual/i, code: 'SD' },
  { re: /pre[-\s]?design/i, code: 'PD' },
  { re: /property\s*eval|master\s*plan|programming/i, code: 'MP' },
  { re: /project\s*manage/i, code: 'PM' },
  { re: /render/i, code: '3D' },
];

export function phaseAbbrev(phase: string | null | undefined): string {
  if (!phase) return '—';
  const p = phase.trim();
  for (const { re, code } of RULES) {
    if (re.test(p)) return code;
  }
  const words = p.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function managerInitials(name: string | null | undefined): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

export function statusAbbrev(status: string | null | undefined): string {
  if (!status) return '—';
  const s = status.toUpperCase();
  if (s === 'ACTIVE') return 'Actv';
  if (s === 'COMPLETED') return 'Comp';
  if (s === 'INACTIVE') return 'Inact';
  if (s === 'HOLD') return 'Hold';
  return s.slice(0, 4);
}

export function typeAbbrev(type: string | null | undefined): string {
  if (!type) return '—';
  const t = type.toUpperCase();
  if (t.includes('FIXED') || t === 'FX') return 'FX';
  if (t.includes('HOUR') || t === 'HR') return 'HR';
  return t.slice(0, 3);
}
