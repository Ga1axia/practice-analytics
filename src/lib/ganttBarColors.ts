import type { StatusTone } from './scheduleSections';

/** Distinct hues per phase/section so adjacent bars are easy to tell apart. */
export const GANTT_PHASE_PALETTE = [
  '#146C6B',
  '#2563A8',
  '#6B4E9A',
  '#B45309',
  '#047857',
  '#BE123C',
  '#0E7490',
  '#4D7C0F',
  '#7C3AED',
  '#C2410C',
] as const;

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')}`;
}

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const u = Math.max(0, Math.min(1, t));
  return toHex(ar + (br - ar) * u, ag + (bg - ag) * u, ab + (bb - ab) * u);
}

export function ganttBarBackground(input: {
  tone: StatusTone;
  kind: 'phase' | 'task' | 'subtask';
  paletteIndex: number;
}): { background: string; borderColor?: string } {
  const base = GANTT_PHASE_PALETTE[input.paletteIndex % GANTT_PHASE_PALETTE.length]!;

  switch (input.tone) {
    case 'done':
      return { background: '#2E7D46', borderColor: '#1B5E34' };
    case 'idle':
      return { background: '#94A3B8', borderColor: '#64748B' };
    case 'na':
      return { background: '#CBD5E1', borderColor: '#94A3B8' };
    case 'muted':
      return { background: '#B9C2CF', borderColor: '#94A3B8' };
    case 'date':
      return {
        background: mixHex(base, '#D97706', 0.42),
        borderColor: mixHex(base, '#92400E', 0.35),
      };
    case 'active':
    default:
      if (input.kind === 'phase') {
        return {
          background: mixHex(base, '#0F172A', 0.22),
          borderColor: mixHex(base, '#0F172A', 0.45),
        };
      }
      if (input.kind === 'subtask') {
        return {
          background: mixHex(base, '#FFFFFF', 0.38),
          borderColor: mixHex(base, '#0F172A', 0.18),
        };
      }
      return { background: base, borderColor: mixHex(base, '#0F172A', 0.28) };
  }
}
