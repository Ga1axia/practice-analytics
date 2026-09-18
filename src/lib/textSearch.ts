/** Parse a deterministic search string: whitespace tokens + "exact phrases". */
export function parseDeterministicQuery(raw: string): { phrases: string[]; tokens: string[] } {
  const phrases: string[] = [];
  const tokens: string[] = [];
  const q = raw.trim();
  if (!q) return { phrases, tokens };

  const stripped = q.replace(/"([^"]+)"/g, (_, phrase: string) => {
    const p = phrase.trim().toLowerCase();
    if (p) phrases.push(p);
    return ' ';
  });

  stripped
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .forEach((t) => tokens.push(t));

  return { phrases, tokens };
}

/** Every phrase and token must appear as substrings (case-insensitive). */
export function deterministicTextMatch(haystack: string, rawQuery: string): boolean {
  const { phrases, tokens } = parseDeterministicQuery(rawQuery);
  if (!phrases.length && !tokens.length) return true;
  const h = haystack.toLowerCase();
  for (const p of phrases) {
    if (!h.includes(p)) return false;
  }
  for (const t of tokens) {
    if (!h.includes(t)) return false;
  }
  return true;
}
