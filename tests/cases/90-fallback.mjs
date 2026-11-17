import { req } from '../lib/registry.mjs';

/** Opens chrome://version (a page the overlay can't run on) and returns its tab id. */
async function restrictedTab(t) {
  const id = await t.evalSw(async () => (await chrome.tabs.create({ url: 'chrome://version', active: true })).id);
  await t.waitFor(() => t.evalSw(async (i) => ((await chrome.tabs.get(i)).url || '').startsWith('chrome://version'), id), { what: 'chrome://version' });
  return id;
}

const tabCount = (t) => t.evalSw(async () => (await chrome.tabs.query({})).length);

/** Runs a command on the tab and returns the URL of the one new tab it opens. */
async function newTabFrom(t, command, tabId) {
  const tabs = () => t.evalSw(async () => (await chrome.tabs.query({})).map((x) => ({ id: x.id, url: x.url || x.pendingUrl || '' })));
  const before = new Set((await tabs()).map((x) => x.id));
  await t.command(command, tabId);
  const fresh = await t.waitFor(async () => {
    const f = (await tabs()).filter((x) => !before.has(x.id));
    return f.length && f[0].url ? f : null;
  }, { what: `a new tab from ${command}` });
  t.equal(fresh.length, 1, 'exactly one new tab');
  return fresh[0].url;
}

req('R901', 'The open-palette command on a browser page (`chrome://version`, the Web Store) opens `palette.html?fallback` in a new tab.', async (t) => {
  // Control: on a normal page the command opens no tab (it shows the overlay instead).
  const web = await t.open(t.server.url('/p/Home'));
  const ov = await t.overlay(web.page);
  const n = await tabCount(t);
  await t.command('open-palette', web.tabId);
  await t.waitFor(() => ov.isOpen(), { what: 'overlay open' });
  t.equal(await tabCount(t), n, 'no tab opened on a web page');

  const id = await restrictedTab(t);
  t.equal(await newTabFrom(t, 'open-palette', id), `${t.EXT}/palette.html?fallback`);
});

req('R902', 'With a Fallback URL set, that URL opens instead, without scope or edit parameters.', async (t) => {
  const id = await restrictedTab(t);
  // Control: without a Fallback URL, a scope command passes its scope on.
  t.equal(await newTabFrom(t, 'search-history', id), `${t.EXT}/palette.html?fallback&scope=history`);

  const custom = t.server.url('/p/Custom');
  await t.settings({ fallbackUrl: custom });
  for (const command of ['open-palette', 'search-history', 'open-palette-url']) {
    t.equal(await newTabFrom(t, command, id), custom, command);
  }
});

req('R903', 'The fallback page opened with `scope=<key>` starts in that scope.', async (t) => {
  const plain = await t.palettePage('fallback');
  t.equal(await plain.chip(), null, 'unscoped page has no chip');
  t.equal(await plain.placeholder(), 'Search...');

  const view = await t.palettePage('fallback&scope=history');
  t.equal(await view.chip(), 'History');
  t.equal(await view.placeholder(), 'Search history...');
  t.ok(await view.focused(), 'input focused');
});

req('R904', 'The fallback page ignores an unknown or inherited scope name such as `constructor`, opening unscoped with no error.', async (t) => {
  t.equal(await (await t.palettePage('fallback&scope=bookmarks')).chip(), 'Bookmarks', 'a valid scope shows its chip');
  await t.open(t.server.url('/p/Alpha'));
  for (const name of ['constructor', 'toString', 'nonsense']) {
    const view = await t.palettePage(`fallback&scope=${name}`);
    t.equal(await view.chip(), null, `${name}: no chip`);
    t.equal(await view.placeholder(), 'Search...', `${name}: unscoped placeholder`);
    const titles = await view.waitTitles((x) => x.length > 0, `${name}: rows`);
    t.includes(titles, 'Alpha');
  }
});

req('R905', 'The fallback page opened with `edit=<url>` starts with that URL in the bar and no tab results.', async (t) => {
  await t.open(t.server.url('/p/Alpha'));
  const plain = await t.palettePage('fallback');
  t.includes(await plain.waitTitles((x) => x.includes('Alpha')), 'Alpha', 'a plain page lists open tabs');
  t.equal(await plain.value(), '');

  const url = 'https://edit.example.test/some/page';
  const view = await t.palettePage(`fallback&edit=${encodeURIComponent(url)}`);
  t.equal(await view.value(), url);
  const rows = await view.waitRows((r) => r.length > 0);
  t.excludes(rows.map((r) => r.title), 'Alpha');
});

req('R906', 'The edit-URL command on one of Float\'s own pages refocuses that palette in normal mode and opens no tab.', async (t) => {
  const url = 'https://edit.example.test/some/page';
  const query = `fallback&edit=${encodeURIComponent(url)}`;
  const view = await t.palettePage(query);
  const tabId = await t.evalSw(async (q) => (await chrome.tabs.query({})).find((x) => x.url?.endsWith(`palette.html?${q}`))?.id, query);
  t.ok(tabId != null, 'found the palette tab');
  t.equal(await view.value(), url, 'starts in edit mode');
  // Move focus away, so the refocus is observable.
  await view.eval((root) => root.querySelector('.input').blur());
  t.equal(await view.focused(), false);
  const n = await tabCount(t);

  await t.command('open-palette-url', tabId);
  await t.waitFor(() => view.focused(), { what: 'palette refocused' });
  t.equal(await view.value(), '', 'normal mode: empty input');
  t.equal(await view.chip(), null);
  t.equal(await tabCount(t), n, 'no tab opened');
});
