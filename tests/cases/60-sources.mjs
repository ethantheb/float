import { req } from '../lib/registry.mjs';
import { ask, bare, discard, flush, optionsPage, seen, selectRow, titleOnce, watch } from '../lib/helpers.mjs';

const bookmark = (t, title, url) => t.evalSw((ti, u) => chrome.bookmarks.create({ title: ti, url: u }), title, url);
const visit = (t, url) => t.evalSw((u) => chrome.history.addUrl({ url: u }), url);

req('R601', 'Search sources lists Tabs, Pinned tabs, Bookmarks, History and Browser pages, each On by default.', async (t) => {
  const v = await optionsPage(t);
  await v.type('Search sources');
  await v.waitRows((r) => r.some((x) => x.title === 'Search sources'), 'sources row');
  await selectRow(v, 'Search sources');
  await v.press('Enter');
  const rows = await v.waitRows((r) => r.some((x) => x.title === 'Pinned tabs'), 'sources submenu');
  t.deepEqual(rows.map((r) => [r.title, r.value]), [['Tabs', 'On'], ['Pinned tabs', 'On'], ['Bookmarks', 'On'], ['History', 'On'], ['Browser pages', 'On']]);
  t.equal(await v.chip(), 'Sources');
});

req('R602', 'A source turned off contributes no results, with nothing typed or with text typed.', async (t) => {
  await t.open(t.server.url('/p/Alpha'));
  await t.open(t.server.url('/p/Beta'), { pinned: true });
  await bookmark(t, 'Marked', t.server.url('/p/Marked'));
  await visit(t, t.server.url('/p/Seen'));

  // Nothing typed: the palette lists open tabs.
  const empty = async (what) => (await (await t.palettePage()).waitRows((r) => r.length > 0, what)).map((r) => r.title);
  const both = await empty('tabs');
  t.includes(both, 'Alpha');
  t.includes(both, 'Beta');
  await t.settings({ sources: { tabs: false } });
  const noTabs = await empty('tabs without Tabs');
  t.includes(noTabs, 'Beta');
  t.excludes(noTabs, 'Alpha');
  await t.settings({ sources: { pinned: false } });
  const noPinned = await empty('tabs without Pinned');
  t.includes(noPinned, 'Alpha');
  t.excludes(noPinned, 'Beta');

  // Text typed: each source with a control text (a prefix of the real one, so it is a new query) that finds it.
  const cases = [
    ['tabs', 'alph', 'alpha', (r) => r.title === 'Alpha' && r.badge === 'Switch to Tab'],
    ['pinned', 'bet', 'beta', (r) => r.title === 'Beta' && r.badge === 'Switch to Tab'],
    ['bookmarks', 'marke', 'marked', (r) => r.title === 'Marked'],
    ['history', 'see', 'seen', (r) => r.title.endsWith('/p/Seen')],
    ['chrome', 'flag', 'flags', (r) => r.sub === 'chrome://flags'],
  ];
  const v = await t.palettePage();
  for (const [source, control, text, hit] of cases) {
    await t.settings({ sources: {} });
    t.ok((await ask(v, control)).some(hit), `${source} is found while on`);
    await t.settings({ sources: { [source]: false } });
    t.equal((await ask(v, text)).some(hit), false, `${source} is left out while off`);
  }

  // Bookmarks and history with nothing typed: a scope lists their newest.
  for (const [source, scope, hit] of [['bookmarks', 'bookmarks', cases[2][3]], ['history', 'history', cases[3][3]]]) {
    await t.settings({ sources: {} });
    t.ok((await (await t.palettePage(`fallback&scope=${scope}`)).waitRows((r) => r.some(hit), `${source} scope`)).length > 0);
    await t.settings({ sources: { [source]: false } });
    const rows = await (await t.palettePage(`fallback&scope=${scope}`)).waitRows((r) => r.length > 0, `${source} scope off`);
    t.deepEqual(rows.filter(hit), []);
  }
});

req('R603', 'A source turned off has no Search row; Search tabs stays while either Tabs or Pinned tabs is on.', async (t) => {
  const scopeRows = async () => {
    const v = await t.palettePage();
    const rows = await ask(v, 'search');
    return rows.map((r) => r.title).filter((x) => x.startsWith('Search ')).sort();
  };
  const all = ['Search bookmarks', 'Search history', 'Search tabs'];
  t.deepEqual(await scopeRows(), all, 'all three while every source is on');
  await t.settings({ sources: { bookmarks: false } });
  t.deepEqual(await scopeRows(), ['Search history', 'Search tabs']);
  await t.settings({ sources: { history: false } });
  t.deepEqual(await scopeRows(), ['Search bookmarks', 'Search tabs']);
  await t.settings({ sources: { tabs: false } });
  t.deepEqual(await scopeRows(), all, 'Pinned tabs alone keeps Search tabs');
  await t.settings({ sources: { pinned: false } });
  t.deepEqual(await scopeRows(), all, 'Tabs alone keeps Search tabs');
  await t.settings({ sources: { tabs: false, pinned: false } });
  t.deepEqual(await scopeRows(), ['Search bookmarks', 'Search history']);
});

req('R604', 'Opening a scope whose source is off shows one dimmed row, `Tabs is disabled in Float options` (likewise Bookmarks and History); Enter on it does nothing. For Tabs, both Tabs and Pinned tabs must be off.', async (t) => {
  await t.open(t.server.url('/p/Beta'), { pinned: true });
  await bookmark(t, 'Marked', t.server.url('/p/Marked'));
  const scoped = async (scope) => (await t.palettePage(`fallback&scope=${scope}`)).waitRows((r) => r.length > 0, `${scope} scope`);

  // Controls: with the sources on (or Pinned tabs on for Tabs) the scope lists items, not a note.
  t.includes((await scoped('tabs')).map((r) => r.title), 'Beta');
  t.includes((await scoped('bookmarks')).map((r) => r.title), 'Marked');
  await t.settings({ sources: { tabs: false } });
  t.includes((await scoped('tabs')).map((r) => r.title), 'Beta');

  await t.settings({ sources: { tabs: false, pinned: false, bookmarks: false, history: false } });
  for (const [scope, name] of [['tabs', 'Tabs'], ['bookmarks', 'Bookmarks'], ['history', 'History']]) {
    const rows = await scoped(scope);
    t.equal(rows.length, 1, `${scope}: one row`);
    t.equal(rows[0].title, `${name} is disabled in Float options`);
    t.ok(rows[0].disabled, `${scope}: dimmed`);
  }

  // Enter does nothing on the note, but opens a normal row (control).
  await watch(t);
  const off = await t.palettePage('fallback&scope=bookmarks');
  await off.waitRows((r) => r.length === 1, 'note');
  await off.press('Enter');
  await flush(off);
  t.deepEqual(await seen(t), [], 'no open request from the note');
  t.equal(await off.page.evaluate(() => location.search), '?fallback&scope=bookmarks', 'the page did not navigate');

  await t.settings({ sources: {} });
  const on = await t.palettePage('fallback&scope=bookmarks');
  await on.waitRows((r) => r.some((x) => x.title === 'Marked'), 'bookmark row');
  await on.press('Enter');
  await t.waitFor(async () => (await seen(t)).some((m) => m.type === 'open'), { what: 'an open request' });
  t.ok(true, 'Enter on a real row opens it');
});

req('R605', 'With History off, tab titles are never taken from history; with Bookmarks off, never from bookmarks.', async (t) => {
  // The subtitle is hidden when it repeats the title.
  const row = (rows, path) => rows.find((r) => r.badge === 'Switch to Tab' && [r.title, r.sub].some((x) => x.endsWith(path)));

  // Bookmarks: an untitled tab takes the bookmark's title, until Bookmarks is turned off.
  const untitled = t.server.url('/untitled');
  const { tabId: untitledId } = await t.open(untitled);
  await bookmark(t, 'Bookmarked', untitled);
  // Only tabs that aren't loaded get a fallback title.
  await t.open(t.server.url('/p/Other'));
  await discard(t, untitledId);
  const v = await t.palettePage();
  t.equal(row(await ask(v, 'untitle'), '/untitled')?.title, 'Bookmarked', 'titled from the bookmark while Bookmarks is on');
  await t.settings({ sources: { bookmarks: false } });
  t.equal(row(await ask(v, 'untitled'), '/untitled')?.title, bare(untitled), 'titled by its URL once Bookmarks is off');

  // History: the first visit stored the title, the second page load has none.
  const { server, port } = await titleOnce();
  try {
    await t.settings({ sources: {} });
    const url = `http://www.example.test:${port}/flip`;
    const first = await t.open(url);
    const historyTitle = () => t.evalSw(async (u) => (await chrome.history.search({ text: '', startTime: 0, maxResults: 100 })).find((h) => h.url === u)?.title, url);
    await t.waitFor(async () => (await historyTitle()) === 'Remembered', { what: 'history to learn the title' });
    await t.evalSw((id) => chrome.tabs.remove(id), first.tabId);
    const second = await t.open(url);
    await t.open(t.server.url('/p/Other'));
    const discarded = await discard(t, second.tabId);
    t.notEqual(discarded.title, 'Remembered', 'the open tab has no title of its own');
    t.equal(await historyTitle(), 'Remembered', 'history still has the title');

    const h = await t.palettePage();
    t.equal(row(await ask(h, 'fli'), '/flip')?.title, 'Remembered', 'titled from history while History is on');
    await t.settings({ sources: { history: false } });
    t.equal(row(await ask(h, 'flip'), '/flip')?.title, bare(url), 'titled by its URL once History is off');
  } finally {
    server.close();
  }
});

req('R606', 'In incognito, the history scope shows `History is not searched in incognito` and never regular history.', async (t) => {
  const { tabId } = await t.open(t.server.url('/p/Origin'));
  const seenUrl = 'https://seen.example.test/page';
  await visit(t, seenUrl);
  // Opens the palette on a copy of the tab that claims to be incognito or not, and returns what it sent the page.
  const sent = (incognito) =>
    t.evalSw(
      async (id, inc) => {
        const tab = await chrome.tabs.get(id);
        const original = chrome.tabs.sendMessage;
        let message;
        chrome.tabs.sendMessage = async (_id, m) => void (message = m);
        try {
          await showPalette({ ...tab, url: 'https://example.com/', incognito: inc }, false, 'history');
        } finally {
          chrome.tabs.sendMessage = original;
        }
        return message.results.map((r) => ({ kind: r.kind, title: r.title, url: r.url }));
      },
      tabId,
      incognito,
    );

  t.ok((await sent(false)).some((r) => r.kind === 'history' && r.url === seenUrl), 'a regular window lists history');
  const results = await sent(true);
  t.deepEqual(results, [{ kind: 'note', title: 'History is not searched in incognito', url: '' }]);
});

req('R609', 'Tabs and Pinned tabs step through On, When typed and Off; Bookmarks, History and Browser pages toggle On and Off.', async (t) => {
  const v = await optionsPage(t);
  await v.type('Search sources');
  await v.waitRows((r) => r.some((x) => x.title === 'Search sources'), 'sources row');
  await selectRow(v, 'Search sources');
  await v.press('Enter');
  await v.waitRows((r) => r.some((x) => x.title === 'Pinned tabs'), 'sources submenu');
  const value = async (title) => (await v.rows()).find((r) => r.title === title)?.value;
  const press = async (title, want) => {
    await selectRow(v, title);
    await v.press('Enter');
    await v.waitRows((r) => r.find((x) => x.title === title)?.value === want, `${title}: ${want}`);
    t.equal(await value(title), want);
  };
  for (const title of ['Tabs', 'Pinned tabs']) {
    for (const want of ['When typed', 'Off', 'On']) await press(title, want);
  }
  for (const title of ['Bookmarks', 'History', 'Browser pages']) {
    for (const want of ['Off', 'On']) await press(title, want);
  }
});

req('R610', 'A tab source set to When typed is left out of the list shown with nothing typed, but its tabs are still found by typing and listed in the tabs scope.', async (t) => {
  await t.open(t.server.url('/p/Alpha'));
  await t.open(t.server.url('/p/Beta'), { pinned: true });
  const empty = async (what) => (await (await t.palettePage()).waitRows((r) => r.length > 0, what)).map((r) => r.title);
  const tab = (title) => (r) => r.title === title && r.badge === 'Switch to Tab';

  for (const [source, title, other, text] of [['tabs', 'Alpha', 'Beta', 'alpha'], ['pinned', 'Beta', 'Alpha', 'beta']]) {
    // Control: while On, the tab is listed with nothing typed.
    await t.settings({ sources: {} });
    t.includes(await empty(`${source} on`), title);

    await t.settings({ sources: { [source]: 'typed' } });
    const rows = await empty(`${source} when typed`);
    t.includes(rows, other, `${source}: the other tab source is still listed`);
    t.excludes(rows, title, `${source}: not listed with nothing typed`);

    const v = await t.palettePage();
    t.ok((await ask(v, text)).some(tab(title)), `${source}: typing its title finds it`);

    const scoped = await (await t.palettePage('fallback&scope=tabs')).waitRows((r) => r.some((x) => x.title === title), `${source}: tabs scope`);
    t.ok(scoped.some((r) => r.title === title), `${source}: listed in the tabs scope`);
  }
});
