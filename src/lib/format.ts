export const fmtUSD = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

export const fmtUSDk = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + Math.round(n);
};

export const fmtPct = (n: number) => (n * 100).toFixed(1) + '%';

export const monthLabel = (m: string) => {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
  });
};

export const palette = {
  navy: '#101B2D',
  gold: '#A8783A',
  rust: '#B3261E',
  teal: '#146C6B',
  green: '#2E7D46',
  line: '#4C6580',
};

export function escapeHtml(s: string) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

export function findEntity(text: string, names: (string | null | undefined)[]) {
  const t = text.toLowerCase();
  let best: string | null = null;
  names.forEach((name) => {
    if (!name) return;
    const n = String(name).toLowerCase();
    if (n.length >= 3 && t.includes(n)) {
      if (!best || n.length > best.length) best = name;
    }
  });
  return best;
}
