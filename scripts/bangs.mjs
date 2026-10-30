// Downloads Helium's bang list (the same bangs as Helium's address bar) into
// src/background/bangs.json, which ships with the extension. Review the diff before committing.
// Output: one bang per line, `[name, URL template, ...triggers]`, sorted, so updates diff cleanly.
// Usage: node scripts/bangs.mjs
import { writeFileSync } from 'node:fs';

const SOURCE = 'https://services.helium.imput.net/bangs.json';
const OUT = 'src/background/bangs.json';
const MAX_BYTES = 5 * 1024 * 1024;
/** The list has thousands of bangs; fewer means a broken response. */
const MIN_BANGS = 1000;

const res = await fetch(SOURCE, { signal: AbortSignal.timeout(30_000) });
const type = res.headers.get('content-type')?.split(';')[0].trim();
if (res.status !== 200 || type !== 'application/json') throw new Error(`Bad response: ${res.status} ${type}`);
const text = await res.text();
if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Response too large');

// The list is MIT licensed; its notice is in the leading comment and must ship with it.
const header = text.match(/^(?:\s*\/\/.*\n)+/)?.[0].split('\n').map((l) => l.replace(/^\s*\/\/ ?/, '')) ?? [];
const licenseStart = header.indexOf('MIT License');
if (licenseStart < 0) throw new Error('License notice not found');
const license = header.slice(licenseStart).join('\n').trim();

// JSONC: drop comments and trailing commas, leaving strings untouched.
const STRING = /"(?:\\.|[^"\\])*"/.source;
const keepStrings = (m) => (m[0] === '"' ? m : '');
const json = text
  .replace(new RegExp(`${STRING}|//[^\\n]*|/\\*[\\s\\S]*?\\*/`, 'g'), keepStrings)
  .replace(new RegExp(`${STRING}|,(?=\\s*[\\]}])`, 'g'), keepStrings);
const list = JSON.parse(json);
if (!Array.isArray(list)) throw new Error('Not a list');

const isWebTemplate = (u) => {
  try {
    return u.includes('{searchTerms}') && ['https:', 'http:'].includes(new URL(u.replaceAll('{searchTerms}', 'x')).protocol);
  } catch {
    return false;
  }
};

// Invalid entries and triggers are skipped, as in Helium. A trigger used twice keeps its first bang.
const seen = new Set();
const bangs = [];
let skipped = 0;
for (const entry of list) {
  const { s, ts, u } = entry ?? {};
  if (typeof s !== 'string' || !s.trim() || !Array.isArray(ts) || typeof u !== 'string' || !isWebTemplate(u)) {
    skipped++;
    continue;
  }
  const triggers = [];
  for (const t of ts) {
    const trigger = typeof t === 'string' ? t.toLowerCase() : '';
    if (!trigger || /\s/.test(trigger) || seen.has(trigger)) continue;
    seen.add(trigger);
    triggers.push(trigger);
  }
  if (triggers.length) bangs.push([s.trim(), u, ...triggers]);
  else skipped++;
}
if (bangs.length < MIN_BANGS) throw new Error(`Only ${bangs.length} valid bangs`);

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
bangs.sort((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]));

const lines = bangs.map((b) => '    ' + JSON.stringify(b)).join(',\n');
writeFileSync(OUT, `{\n  "source": ${JSON.stringify(SOURCE)},\n  "license": ${JSON.stringify(license)},\n  "bangs": [\n${lines}\n  ]\n}\n`);
console.log(`${OUT}: ${bangs.length} bangs, ${seen.size} triggers (${skipped} skipped)`);
