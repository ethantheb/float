// Runs the requirement tests: checks the table against the registered tests, then runs them.
//   npm test                 everything (a subset reports INCOMPLETE)
//   npm test -- R101 R204    only these IDs
//   npm test -- --headed    show the browser window (default: headless)
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { Env, DIST, EXT, makeAsserts, sleep, waitFor } from './lib/harness.mjs';
import { current, registry } from './lib/registry.mjs';
import { parseTable, tableChanges, verdict } from './lib/spec.mjs';

const TIMEOUT = 20_000;
const args = process.argv.slice(2);
const headless = !args.includes('--headed');
const only = args.filter((a) => /^[RC]\d+$/.test(a));

const md = readFileSync(new URL('./requirements.md', import.meta.url), 'utf8');
const { rows, errors: parseErrors } = parseTable(md);

// What changed in the table since the last commit: whoever runs the tests must report this.
try {
  const head = execFileSync('git', ['show', 'HEAD:tests/requirements.md'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const changes = tableChanges(head, md);
  if (changes.length) console.log(`Requirements changed since HEAD (review the tests for these):\n${changes.map((c) => `  ${c}`).join('\n')}\n`);
} catch {
  console.log('Requirements table is not committed yet: nothing to compare.\n');
}

const casesDir = new URL('./cases/', import.meta.url);
for (const f of readdirSync(casesDir).filter((f) => f.endsWith('.mjs')).sort()) {
  current.file = `tests/cases/${f}`;
  await import(new URL(f, casesDir).href);
}

const results = new Map();
const tests = registry;
const spec = verdict(rows, tests, results);
// A subset run is for developing tests, so missing tests aren't an error there (it reports INCOMPLETE).
const specErrors = [...parseErrors, ...spec.errors].filter((e) => !only.length || !/auto row has no test/.test(e));
if (specErrors.length) {
  console.log('Table and tests do not line up:');
  for (const e of specErrors) console.log(`  ${e}`);
  process.exit(1);
}

const selected = tests.filter((t) => !only.length || only.includes(t.id));
if (only.length) for (const id of only) if (!tests.some((t) => t.id === id)) console.log(`No test with ID ${id}`);

async function runOne(t, env) {
  const asserts = makeAsserts();
  const ctx = Object.assign(asserts, { env, server: env?.server, EXT, DIST, sleep, waitFor });
  if (env) {
    for (const m of ['open', 'palettePage', 'overlay', 'command', 'showPalette', 'settings', 'evalSw']) ctx[m] = env[m].bind(env);
    await env.reset();
  }
  let error;
  let timer;
  try {
    await Promise.race([t.fn(ctx), new Promise((_, no) => (timer = setTimeout(() => no(new Error(`timed out after ${TIMEOUT / 1000}s`)), TIMEOUT)))]);
    if (env?.pageErrors.length) throw new Error(`page errors during the test:\n      ${env.pageErrors.join('\n      ')}`);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timer);
  }
  if (!error && !asserts.count) error = 'the test asserted nothing';
  return { error, assertions: asserts.count };
}

let env;
const start = Date.now();
try {
  if (selected.some((t) => t.browser)) env = await Env.start({ headless });
  for (const t of selected) {
    const r = await runOne(t, t.browser ? env : null);
    results.set(t.id, r);
    console.log(`${r.error ? '✗' : '✓'} ${t.id}  ${t.text}${r.error ? `\n    ${r.error.replace(/\n/g, '\n    ')}` : ''}`);
  }
} catch (e) {
  console.log(`Could not run the browser tests: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await env?.stop();
}

const final = verdict(rows, tests, results);
const manual = rows.filter((r) => r.status === 'manual');
console.log(`\n${results.size} run, ${[...results.values()].filter((r) => r.error).length} failed, ${manual.length} manual rows (${((Date.now() - start) / 1000).toFixed(0)}s)`);
const hard = final.failures.length + final.errors.filter((e) => !only.length || !/auto row has no test/.test(e)).length;
if (hard) {
  console.log('FAILED');
  process.exit(1);
}
if (!final.complete) {
  console.log(`INCOMPLETE: ${final.notRun.length} auto rows did not run${final.notRun.length < 12 ? ` (${final.notRun.join(', ')})` : ''}.`);
  process.exit(1);
}
console.log('PASSED: every auto row has a passing test.');
