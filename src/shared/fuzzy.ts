export const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

const isWordChar = (c: number) => (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c > 127;

/**
 * Scores how well query `q` matches text `t`. Both must be lowercase.
 * Returns 0 for no match, ~1 for a prefix match. Every whitespace-separated
 * query token must match.
 */
export function score(q: string, t: string): number {
  if (!q.includes(' ')) return tokenScore(q, t);
  let sum = 0;
  let n = 0;
  for (const tok of q.split(' ')) {
    if (!tok) continue;
    const s = tokenScore(tok, t);
    if (!s) return 0;
    sum += s;
    n++;
  }
  return n ? sum / n : 0;
}

function tokenScore(q: string, t: string): number {
  // Shorter targets win ties.
  const fit = 1 - Math.min(t.length, 200) / 2000;

  let first = -1;
  for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + 1)) {
    if (i === 0) return fit;
    if (!isWordChar(t.charCodeAt(i - 1))) return 0.8 * fit;
    if (first < 0) first = i;
  }
  if (first >= 0) return 0.6 * fit;

  // Subsequence match, only for queries long enough to be meaningful.
  if (q.length < 3) return 0;
  let ti = 0;
  let start = -1;
  let boundaries = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const k = t.indexOf(q[qi], ti);
    if (k === -1) return 0;
    if (start < 0) start = k;
    if (k === 0 || !isWordChar(t.charCodeAt(k - 1))) boundaries++;
    ti = k + 1;
  }
  const span = ti - start;
  if (span > q.length * 3) return 0;
  return (0.2 + 0.2 * (q.length / span) + 0.1 * (boundaries / q.length)) * fit;
}
