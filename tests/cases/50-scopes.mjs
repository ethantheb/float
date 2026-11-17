import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { req } from '../lib/registry.mjs';

const NAMES = { tabs: 'Tabs', bookmarks: 'Bookmarks', history: 'History' };

/** Selects the input's text, so the next typing replaces it. */
const selectAll = (view) => view.eval((root) => root.querySelector('.input').select());

/** Visits a page (a history entry with its title), then closes its tab. Returns the URL. */
async function visit(t, title) {
  const url = t.server.url(`/p/${title}`);
  const { page } = await t.open(url);
  await t.waitFor(() => t.evalSw(async (u) => (await chrome.history.search({ text: '', startTime: 0, maxResults: 100 })).some((h) => h.url === u && h.title), url), { what: `${title} in history` });
  await page.close();
  return url;
}

/** One page per source, with titles that match "settings" and "search" (so a scope's lack of other rows shows), and one that doesn't. */
async function seedSources(t) {
  const tab = await t.open(t.server.url('/p/settings-search-tab'));
  await t.open(t.server.url('/p/Quux-tab'));
  // Open tabs are history too; only the history scope should have history pages.
  await t.evalSw((urls) => Promise.all(urls.map((u) => chrome.history.deleteUrl({ url: u }))), [t.server.url('/p/settings-search-tab'), t.server.url('/p/Quux-tab')]);
  await t.evalSw(async () => {
    const [bar] = (await chrome.bookmarks.getTree())[0].children;
    await chrome.bookmarks.create({ parentId: bar.id, title: 'settings-search-bookmark', url: 'http://www.example.test/bm1' });
    await chrome.bookmarks.create({ parentId: bar.id, title: 'Quux-bookmark', url: 'http://www.example.test/bm2' });
  });
  await visit(t, 'settings-search-history');
  await visit(t, 'Quux-history');
  return tab;
}

/** Types `text` into the palette and waits for a row titled `title` to appear. */
async function search(view, text, title) {
  await selectAll(view);
  await view.type(text);
  return view.waitRows((r) => r.some((x) => x.title === title));
}

/** Types a scope's name and enters it through its row. */
async function enterScope(t, key) {
  const view = await t.palettePage('fallback');
  const title = `Search ${key}`;
  await view.type(title.toLowerCase());
  const rows = await view.waitRows((r) => r.some((x) => x.title === title));
  const at = rows.findIndex((x) => x.title === title);
  for (let i = 0; i < at; i++) await view.press('ArrowDown');
  await view.press('Enter');
  return view;
}

req('R501', 'Typing "search tabs", "search bookmarks" or "search history" offers a row that enters that scope.', async (t) => {
  for (const key of Object.keys(NAMES)) {
    const scoped = await enterScope(t, key);
    t.equal(await scoped.chip(), NAMES[key]);
    t.equal(await scoped.placeholder(), `Search ${key}...`);
    await scoped.page.close();
  }
});

req('R502', 'In a scope, a chip names the source, the placeholder reads `Search <source>...`, and only that source\'s items are listed: no search or open row, browser pages, Float options or Search rows.', async (t) => {
  await seedSources(t);
  const items = { tabs: 'settings-search-tab', bookmarks: 'settings-search-bookmark', history: 'settings-search-history' };

  // Control: unscoped, the same texts do list a search row, browser pages, Float options and Search rows.
  const plain = await t.palettePage('fallback');
  const settings = await search(plain, 'settings', 'Float options');
  t.ok(settings.some((r) => r.sub === 'Search the web'), 'a search row');
  t.ok(settings.some((r) => r.sub === 'chrome://settings'), 'a browser page');
  const searching = await search(plain, 'search', 'Search tabs');
  t.ok(searching.some((r) => r.sub === 'Search the web'), 'a search row');
  await plain.page.close();

  for (const key of Object.keys(NAMES)) {
    const view = await t.palettePage(`fallback&scope=${key}`);
    t.equal(await view.chip(), NAMES[key]);
    t.equal(await view.placeholder(), `Search ${key}...`);
    // Before typing: the source's items only (two of them, so the filter below is visible).
    await view.waitRows((r) => r.length >= 2);
    for (const text of ['settings', 'search']) {
      await selectAll(view);
      await view.type(text);
      const titles = await view.waitTitles((x) => x.length === 1);
      t.deepEqual(titles, [items[key]], `${key}: "${text}"`);
    }
    await view.page.close();
  }
});

req('R503', 'In the tabs scope with nothing typed, tabs are listed most recently used first.', async (t) => {
  const opened = {};
  for (const n of [1, 2, 3, 4]) opened[n] = await t.open(t.server.url(`/p/Tab${n}`));
  await t.evalSw((id) => chrome.tabs.update(id, { active: true }), opened[2].tabId);
  const view = await t.palettePage('fallback&scope=tabs');
  const titles = await view.waitTitles((x) => x.length >= 4);
  t.deepEqual(titles.slice(0, 4), ['Tab2', 'Tab4', 'Tab3', 'Tab1']);
});

req('R504', 'In the bookmarks scope with nothing typed, the most recently added bookmarks are listed first.', async (t) => {
  await t.evalSw(async () => {
    const [bar, other] = (await chrome.bookmarks.getTree())[0].children;
    // Alternating folders, so the order isn't just the folders' order. Each gets its own millisecond.
    for (const [title, folder] of [['B1', other], ['B2', bar], ['B3', other]]) {
      await chrome.bookmarks.create({ parentId: folder.id, title, url: `http://www.example.test/${title}` });
      for (const start = Date.now(); Date.now() === start; );
    }
  });
  const view = await t.palettePage('fallback&scope=bookmarks');
  t.deepEqual(await view.waitTitles((x) => x.length === 3), ['B3', 'B2', 'B1']);
});

req('R505', 'In the history scope with nothing typed, the most recently visited pages are listed first, leaving out the page the palette was opened from.', async (t) => {
  for (const n of [1, 2, 3]) await visit(t, `Hist${n}`);
  const origin = await t.open(t.server.url('/p/Origin'));
  const inHistory = (title) => t.evalSw(async (x) => (await chrome.history.search({ text: '', startTime: 0, maxResults: 100 })).some((h) => h.title === x), title);
  await t.waitFor(() => inHistory('Origin'), { what: 'the origin page in history' });
  t.ok(await inHistory('Origin'), 'control: the origin page is the newest history entry');

  const ov = await t.overlay(origin.page);
  await t.command('search-history', origin.tabId);
  await t.waitFor(() => ov.isOpen(), { what: 'overlay open' });
  t.equal(await ov.chip(), 'History');
  t.deepEqual(await ov.titles(), ['Hist3', 'Hist2', 'Hist1']);
});

req('R506', 'Esc in a scope or bang chip removes the chip and searches the typed text normally.', async (t) => {
  await t.open(t.server.url('/p/Quux-tab'));

  // Scope: the chip narrows the list; after Esc the same text is searched across everything.
  const scoped = await t.palettePage('fallback&scope=tabs');
  await scoped.type('Quux');
  t.deepEqual(await scoped.waitTitles((x) => x.length === 1), ['Quux-tab']);
  t.equal(await scoped.chip(), 'Tabs');
  await scoped.press('Escape');
  t.equal(await scoped.chip(), null);
  t.equal(await scoped.value(), 'Quux');
  const rows = await scoped.waitRows((r) => r.some((x) => x.sub === 'Search the web'));
  t.equal(rows.find((x) => x.sub === 'Search the web').title, 'Quux');

  // Bang: after Esc the bang is gone and the text is an ordinary search.
  const bang = await t.palettePage('fallback');
  await bang.type('!g ');
  await t.waitFor(async () => (await bang.chip()) !== null, { what: 'bang chip' });
  await bang.type('rust');
  await bang.waitRows((r) => r[0]?.title === 'rust' && r[0].sub.startsWith('Search ') && r[0].sub !== 'Search the web');
  await bang.press('Escape');
  t.equal(await bang.chip(), null);
  t.equal(await bang.value(), 'rust');
  const after = await bang.waitRows((r) => r[0]?.sub === 'Search the web');
  t.equal(after[0].title, 'rust');
});

req('R507', 'Backspace with the caret at the start of the input removes a scope or bang chip and keeps the typed text.', async (t) => {
  const scoped = await t.palettePage('fallback&scope=tabs');
  const bang = await t.palettePage('fallback');
  await bang.type('!g ');
  await t.waitFor(async () => (await bang.chip()) !== null, { what: 'bang chip' });

  for (const view of [bang, scoped]) {
    // The scoped page is behind the bang page now; bring it to the front.
    await view.page.bringToFront();
    const before = await view.chip();
    t.notEqual(before, null, 'a chip to remove');
    await view.type('abc');
    // Control: with the caret at the end, Backspace edits the text and keeps the chip.
    await view.press('Backspace');
    t.equal(await view.value(), 'ab');
    t.equal(await view.chip(), before, 'the chip stays while the caret is not at the start');
    await view.press('Home', 'Backspace');
    t.equal(await view.chip(), null, 'the chip is removed');
    t.equal(await view.value(), 'ab', 'the text is kept');
  }
});

req('R508', 'The Search tabs, bookmarks and history rows show only a title, with no secondary text.', async (t) => {
  const view = await t.palettePage('fallback');
  await view.type('search');
  const rows = await view.waitRows((r) => ['Search tabs', 'Search bookmarks', 'Search history'].every((n) => r.some((x) => x.title === n)));
  // Control: the web search row for the same text does show secondary text.
  t.equal(rows.find((r) => r.title === 'search').sub, 'Search the web');
  for (const name of ['Search tabs', 'Search bookmarks', 'Search history']) {
    const row = rows.find((r) => r.title === name);
    t.equal(row.sub, '', name);
    t.equal(row.badge, '', name);
  }
});

req('R509', 'The manifest has search-tabs, search-bookmarks and search-history commands with no default key.', async (t) => {
  const { commands } = JSON.parse(readFileSync(join(t.DIST, 'manifest.json'), 'utf8'));
  // Control: other commands do have default keys, so the check can tell.
  t.ok(commands['open-palette'].suggested_key, 'open-palette has a default key');
  for (const name of ['search-tabs', 'search-bookmarks', 'search-history']) {
    t.ok(commands[name], `${name} exists`);
    t.equal(commands[name].suggested_key, undefined, `${name} has no default key`);
  }
}, { browser: false });

req('R510', 'A scope command opens the palette in that scope.', async (t) => {
  for (const key of Object.keys(NAMES)) {
    const { page, tabId } = await t.open(t.server.url(`/p/Scope-${key}`));
    const ov = await t.overlay(page);
    t.equal(await ov.isOpen(), false);
    await t.command(`search-${key}`, tabId);
    await t.waitFor(() => ov.isOpen(), { what: 'overlay open' });
    t.equal(await ov.chip(), NAMES[key]);
    t.equal(await ov.placeholder(), `Search ${key}...`);
  }
});

req('R511', 'Pressing a scope command again after leaving that scope with Esc enters the scope instead of closing.', async (t) => {
  for (const key of Object.keys(NAMES)) {
    const { page, tabId } = await t.open(t.server.url(`/p/Again-${key}`));
    const ov = await t.overlay(page);
    await t.command(`search-${key}`, tabId);
    await t.waitFor(async () => (await ov.chip()) === NAMES[key], { what: 'scope chip' });

    await ov.press('Escape');
    t.equal(await ov.chip(), null, 'Esc left the scope');
    t.ok(await ov.isOpen(), 'the overlay stays open');

    await t.command(`search-${key}`, tabId);
    await t.waitFor(async () => (await ov.chip()) === NAMES[key], { what: 'scope chip again' });
    t.ok(await ov.isOpen(), 'the overlay stays open');
  }
});

req('R512', 'The scope commands and the edit-URL command work on browser pages by opening the fallback page.', async (t) => {
  const tab = await t.evalSw(() => chrome.tabs.create({ url: 'chrome://version', active: true }));
  const browserUrl = await t.waitFor(() => t.evalSw((id) => chrome.tabs.get(id).then((x) => x.url), tab.id), { what: 'browser page url' });
  const fallbackTab = (url) => t.waitFor(() => t.evalSw((u) => chrome.tabs.query({}).then((all) => all.some((x) => (x.url || x.pendingUrl) === u)), url), { what: `a tab at ${url}` });

  const tabUrls = () => t.evalSw(() => chrome.tabs.query({}).then((all) => all.map((x) => x.url || x.pendingUrl)));
  for (const key of Object.keys(NAMES)) {
    const url = `${t.EXT}/palette.html?fallback&scope=${key}`;
    await t.command(`search-${key}`, tab.id);
    await fallbackTab(url);
    t.includes(await tabUrls(), url, `search-${key} opens the fallback page`);
  }
  const url = `${t.EXT}/palette.html?fallback&${new URLSearchParams({ edit: browserUrl })}`;
  await t.command('open-palette-url', tab.id);
  await fallbackTab(url);
  t.includes(await tabUrls(), url, `open-palette-url opens the fallback page`);
});
