// Pure logic for the requirements table: parsing, coverage checks, the verdict, and the
// table-changes report. No browser and no file access, so tests/meta.test.mjs can feed it fakes.

/** Spacing and Unicode form don't count as a change; wording, case and punctuation do. */
export const normalize = (s) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

const ID = /^(R\d{3}|C\d{2})$/;
const STATUSES = ['auto', 'manual'];

/** Splits a markdown table row into cells (`\|` is a literal pipe). */
function cells(line) {
  const parts = line.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
  if (parts[0] === '') parts.shift();
  if (parts.at(-1) === '') parts.pop();
  return parts;
}

/** Rows of every table in the markdown. Malformed rows are errors, never skipped. */
export function parseTable(markdown) {
  const rows = [];
  const errors = [];
  markdown.split(/\r?\n/).forEach((line, i) => {
    if (!line.trimStart().startsWith('|')) return;
    const c = cells(line);
    if (c.every((x) => /^:?-{3,}:?$/.test(x)) || c[0] === 'ID') return;
    const at = `requirements.md:${i + 1}`;
    if (c.length !== 3) return errors.push(`${at}: expected 3 cells (ID, Behavior, Status), found ${c.length}`);
    const [id, text, status] = c;
    if (!ID.test(id)) return errors.push(`${at}: bad ID "${id}" (expected R123 or C12)`);
    if (!STATUSES.includes(status)) return errors.push(`${at}: ${id} has status "${status}" (only "auto" or "manual")`);
    if (!normalize(text)) return errors.push(`${at}: ${id} has no behavior text`);
    rows.push({ id, text: normalize(text), status, line: i + 1 });
  });
  if (!rows.length && !errors.length) errors.push('requirements.md has no rows');
  return { rows, errors };
}

/** Everything wrong with how the table and the registered tests line up. */
export function checkSpec(rows, tests) {
  const errors = [];
  const byId = new Map();
  const seenText = new Map();
  for (const r of rows) {
    if (byId.has(r.id)) errors.push(`${r.id}: appears twice in the table`);
    byId.set(r.id, r);
    const other = seenText.get(r.text);
    if (other) errors.push(`${r.id}: same behavior text as ${other}`);
    else seenText.set(r.text, r.id);
  }
  const testById = new Map();
  for (const t of tests) {
    if (testById.has(t.id)) errors.push(`${t.id}: has more than one test`);
    testById.set(t.id, t);
    const row = byId.get(t.id);
    if (!row) errors.push(`${t.id}: test exists but the table has no such row${where(t)}`);
    else if (row.status === 'manual') errors.push(`${t.id}: test exists for a manual row. Delete the test, or make the row auto${where(t)}`);
    else if (normalize(t.text) !== row.text) {
      errors.push(`${t.id}: the row's text changed, so its test needs review${where(t)}\n    table: ${row.text}\n    test:  ${normalize(t.text)}`);
    }
  }
  for (const r of rows) if (r.status === 'auto' && !testById.has(r.id)) errors.push(`${r.id}: auto row has no test`);
  return errors;
}

const where = (t) => (t.file ? ` (${t.file})` : '');

/**
 * `results`: Map of id -> { error?: string, assertions: number } for the tests that ran.
 * The run is complete only if every auto row ran, so a subset or skipped browser never reads as all-pass.
 */
export function verdict(rows, tests, results) {
  const errors = checkSpec(rows, tests);
  const failures = [];
  for (const [id, r] of results) {
    if (r.error) failures.push(`${id}: ${r.error}`);
    else if (!r.assertions) failures.push(`${id}: the test asserted nothing`);
  }
  const notRun = rows.filter((r) => r.status === 'auto' && !results.has(r.id)).map((r) => r.id);
  return { ok: !errors.length && !failures.length, complete: !notRun.length, errors, failures, notRun };
}

/** A readable list of what changed between two versions of the table, for the run's report. */
export function tableChanges(oldMarkdown, newMarkdown) {
  const before = new Map(parseTable(oldMarkdown).rows.map((r) => [r.id, r]));
  const after = new Map(parseTable(newMarkdown).rows.map((r) => [r.id, r]));
  const out = [];
  for (const [id, r] of after) {
    const old = before.get(id);
    if (!old) out.push(`${id} added (${r.status}): ${r.text}`);
    else {
      if (old.text !== r.text) out.push(`${id} text changed:\n    was: ${old.text}\n    now: ${r.text}`);
      if (old.status !== r.status) out.push(`${id} status ${old.status} -> ${r.status}`);
    }
  }
  for (const [id, r] of before) if (!after.has(id)) out.push(`${id} removed: ${r.text}`);
  return out;
}
