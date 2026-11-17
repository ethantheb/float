// Tests of the test harness itself (no browser): the table and verdict rules that stop a
// requirement from silently losing its test. Run by `npm test` before anything else.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkSpec, normalize, parseTable, tableChanges, verdict } from './lib/spec.mjs';

const table = (...rows) => `| ID | Behavior | Status |\n| --- | --- | --- |\n${rows.join('\n')}\n`;
const rows = (...r) => parseTable(table(...r)).rows;
const ok = (id) => [id, { assertions: 1 }];

test('a correct table and tests pass', () => {
  const r = rows('| R101 | It opens. | auto |', '| R102 | Someone checks. | manual |');
  const v = verdict(r, [{ id: 'R101', text: 'It opens.' }], new Map([ok('R101')]));
  assert.deepEqual([v.ok, v.complete, v.errors, v.failures], [true, true, [], []]);
});

test('a failing test fails the run', () => {
  const r = rows('| R101 | It opens. | auto |');
  const v = verdict(r, [{ id: 'R101', text: 'It opens.' }], new Map([['R101', { assertions: 1, error: 'boom' }]]));
  assert.equal(v.ok, false);
  assert.match(v.failures[0], /R101: boom/);
});

test('a test that asserts nothing fails', () => {
  const r = rows('| R101 | It opens. | auto |');
  const v = verdict(r, [{ id: 'R101', text: 'It opens.' }], new Map([['R101', { assertions: 0 }]]));
  assert.equal(v.ok, false);
  assert.match(v.failures[0], /asserted nothing/);
});

test('a changed row text fails until the test is reviewed', () => {
  const r = rows('| R101 | It opens quickly. | auto |');
  const errors = checkSpec(r, [{ id: 'R101', text: 'It opens.' }]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /text changed/);
});

test('spacing differences are not a change, wording and punctuation are', () => {
  assert.equal(normalize('  a   b\n c '), 'a b c');
  const r = rows('| R101 | It  opens. | auto |');
  assert.deepEqual(checkSpec(r, [{ id: 'R101', text: 'It opens.' }]), []);
  assert.equal(checkSpec(r, [{ id: 'R101', text: 'It opens' }]).length, 1);
  assert.equal(checkSpec(r, [{ id: 'R101', text: 'it opens.' }]).length, 1);
});

test('an auto row without a test fails', () => {
  const r = rows('| R101 | It opens. | auto |');
  assert.match(checkSpec(r, [])[0], /R101: auto row has no test/);
});

test('a test for an unknown ID fails', () => {
  const r = rows('| R101 | It opens. | auto |');
  const errors = checkSpec(r, [{ id: 'R101', text: 'It opens.' }, { id: 'R999', text: 'x' }]);
  assert.match(errors.join('\n'), /R999: test exists but the table has no such row/);
});

test('a test for a manual row fails, so downgrading a row cannot hide its test', () => {
  const r = rows('| R101 | It opens. | manual |');
  assert.match(checkSpec(r, [{ id: 'R101', text: 'It opens.' }])[0], /manual row/);
});

test('a manual row without a test never fails', () => {
  const r = rows('| R101 | Someone checks. | manual |');
  const v = verdict(r, [], new Map());
  assert.deepEqual([v.ok, v.complete], [true, true]);
});

test('two tests for one ID fail', () => {
  const r = rows('| R101 | It opens. | auto |');
  const t = { id: 'R101', text: 'It opens.' };
  assert.match(checkSpec(r, [t, t]).join('\n'), /more than one test/);
});

test('a duplicate ID or duplicate text in the table fails', () => {
  assert.match(checkSpec(rows('| R101 | A. | auto |', '| R101 | B. | auto |'), []).join('\n'), /R101: appears twice/);
  assert.match(checkSpec(rows('| R101 | A. | manual |', '| R102 | A. | manual |'), []).join('\n'), /same behavior text/);
});

test('a bad status, bad ID, wrong cell count or empty text is a parse error', () => {
  for (const bad of ['| R101 | A. | Auto |', '| R101 | A. | skip |', '| 101 | A. | auto |', '| R101 | A. |', '| R101 | A. | auto | x |', '| R101 |  | auto |']) {
    assert.equal(parseTable(table(bad)).errors.length, 1, bad);
  }
});

test('a table with no rows fails instead of passing vacuously', () => {
  assert.equal(parseTable('# nothing here\n').errors.length, 1);
  assert.equal(parseTable(table()).errors.length, 1);
});

test('escaped pipes and code spans parse', () => {
  const r = rows('| R101 | Typing `a \\| b` works. | auto |');
  assert.equal(r[0].text, 'Typing `a | b` works.');
});

test('a run that did not reach every auto row is incomplete, not passing', () => {
  const r = rows('| R101 | A. | auto |', '| R102 | B. | auto |');
  const tests = [{ id: 'R101', text: 'A.' }, { id: 'R102', text: 'B.' }];
  const v = verdict(r, tests, new Map([ok('R101')]));
  assert.deepEqual([v.ok, v.complete, v.notRun], [true, false, ['R102']]);
});

test('table changes are reported: added, removed, reworded, status flipped', () => {
  const before = table('| R101 | A. | auto |', '| R102 | B. | auto |', '| R103 | C. | auto |');
  const after = table('| R101 | A changed. | auto |', '| R102 | B. | manual |', '| R104 | D. | auto |');
  const out = tableChanges(before, after).join('\n');
  assert.match(out, /R101 text changed/);
  assert.match(out, /R102 status auto -> manual/);
  assert.match(out, /R103 removed/);
  assert.match(out, /R104 added/);
});

test('the real requirements table is well-formed', () => {
  const { rows: real, errors } = parseTable(readFileSync(new URL('./requirements.md', import.meta.url), 'utf8'));
  assert.deepEqual(errors, []);
  assert.ok(real.length > 50);
  assert.deepEqual(checkSpec(real, []).filter((e) => !/auto row has no test/.test(e)), []);
});
