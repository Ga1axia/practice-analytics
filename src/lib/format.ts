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
  const STOP = new Set([
    'the', 'and', 'for', 'what', 'which', 'how', 'many', 'much', 'who', 'is', 'are',
    'of', 'to', 'a', 'an', 'in', 'on', 'at', 'by', 'with', 'from', 'total', 'amount',
    'client', 'project', 'manager', 'billed', 'contract', 'profit', 'active',
  ]);
  const q = text.toLowerCase();
  const score = (name: string) => {
    const n = name.toLowerCase().trim();
    if (n.length < 3) return 0;
    if (q.includes(n)) return 1000 + n.length;
    const tokens = n.split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t));
    let hit = 0;
    let hitLen = 0;
    for (const t of tokens) {
      const re = new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`);
      if (re.test(q)) {
        hit += 1;
        hitLen += t.length;
      }
    }
    if (!hit) return 0;
    if (hit === 1 && hitLen < 5 && tokens.length > 1) return 0;
    return hit * 50 + hitLen;
  };
  let best: string | null = null;
  let bestScore = 0;
  names.forEach((name) => {
    if (!name) return;
    const s = score(name);
    if (s > bestScore) {
      bestScore = s;
      best = name;
    }
  });
  return best;
}
