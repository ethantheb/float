import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { req } from '../lib/registry.mjs';

const NO_BROWSER = { browser: false };
const read = (t, f) => readFileSync(join(t.DIST, f), 'utf8');

req('C01', '`content.js` is at most 20,480 bytes.', async (t) => {
  const size = statSync(join(t.DIST, 'content.js')).size;
  t.ok(size > 1000, `content.js is not empty (${size} bytes)`);
  t.ok(size <= 20480, `content.js is ${size} bytes`);
}, NO_BROWSER);

req('C02', 'No built script uses an HTML-parsing sink (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `DOMParser`, `srcdoc`).', async (t) => {
  const sinks = /innerHTML|outerHTML|insertAdjacentHTML|document\s*\.\s*write|DOMParser|srcdoc/g;
  const files = readdirSync(t.DIST).filter((f) => f.endsWith('.js'));
  t.deepEqual(files.filter((f) => ['background.js', 'content.js', 'palette.js'].includes(f)).sort(), ['background.js', 'content.js', 'palette.js']);
  // Control: the scanner finds sinks in text that has them.
  t.equal('x.innerHTML=y;document.write(1)'.match(sinks).length, 2);
  for (const f of files) {
    const src = read(t, f);
    t.ok(src.length > 1000, `${f} is not empty`);
    t.deepEqual(src.match(sinks) ?? [], [], f);
  }
}, NO_BROWSER);

req('C03', 'The service worker registers no listener that fires on routine browsing (`history.onVisited`, `tabs.onUpdated`, `tabs.onActivated`, `webNavigation`).', async (t) => {
  const src = read(t, 'background.js');
  // Control: the scan sees real listener registrations.
  t.match(src, /chrome\.commands\.onCommand\.addListener/);
  t.match(src, /chrome\.runtime\.onMessage\.addListener/);
  for (const api of ['history.onVisited', 'tabs.onUpdated', 'tabs.onActivated', 'onVisited', 'onUpdated', 'onActivated', 'webNavigation']) {
    t.equal(src.includes(api), false, api);
  }
  const manifest = JSON.parse(read(t, 'manifest.json'));
  t.ok(manifest.permissions.length > 0);
  t.excludes([...manifest.permissions, ...(manifest.optional_permissions ?? [])], 'webNavigation');
}, NO_BROWSER);

req('C04', 'The manifest `key` is present and unchanged.', async (t) => {
  const built = JSON.parse(read(t, 'manifest.json')).key;
  const source = JSON.parse(readFileSync('src/manifest.json', 'utf8')).key;
  t.ok(typeof built === 'string' && built.length > 100, 'key present');
  t.equal(built, source, 'built key equals the source key');
  const hash = createHash('sha256').update(Buffer.from(built, 'base64')).digest('hex').slice(0, 32);
  const id = [...hash].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
  t.equal(id, 'ielgjbnkjikemadobenfanpmchjjokff');
}, NO_BROWSER);
