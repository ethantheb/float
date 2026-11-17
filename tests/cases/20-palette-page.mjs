import { req } from '../lib/registry.mjs';
import { View } from '../lib/harness.mjs';

const tabsWhere = async (t, fn) => (await t.evalSw(() => chrome.tabs.query({}))).filter(fn);

/** The View of the (single) open page whose URL is `url`. */
async function viewOf(t, url) {
  const page = await t.waitFor(async () => (await t.env.browser.pages()).find((p) => p.url() === url), { what: `page ${url}` });
  const view = new View(page, false);
  await view.ready();
  return view;
}

/** Opens a new tab like Ctrl-T does (no URL), and returns the ID it was created with. */
const newTab = (t) => t.evalSw(async () => (await chrome.tabs.create({})).id);

/**
 * The new tab page decides from a settings copy cached in localStorage, which only a mounted palette
 * refreshes (as happens when settings are changed in options mode). Settings written straight to storage
 * leave it stale, so open a palette page and wait for it to catch up before making new tabs.
 */
async function syncNewTabCache(t) {
  const view = await t.palettePage('fallback');
  const want = await t.evalSw(() => chrome.storage.sync.get({ newTab: 'float', newTabUrl: '' }));
  await t.waitFor(() => view.page.evaluate((w) => {
    const c = JSON.parse(localStorage.getItem('float-settings') || '{}');
    return (c.newTab ?? 'float') === w.newTab && (c.newTabUrl ?? '') === w.newTabUrl;
  }, want), { what: 'new tab settings cache' });
  await view.page.close();
}

req('R201', 'A new tab with default settings becomes `palette.html?tab` with the input focused.', async (t) => {
  await syncNewTabCache(t);
  const created = await newTab(t);
  const tab = await t.waitFor(async () => (await tabsWhere(t, (x) => (x.url || x.pendingUrl) === `${t.EXT}/palette.html?tab`))[0], { what: 'palette.html?tab tab' });
  t.notEqual(tab.id, created, 'the browser new tab page was swapped for an extension-made tab');
  const view = await viewOf(t, `${t.EXT}/palette.html?tab`);
  await t.waitFor(() => view.focused(), { what: 'input focused' });
  t.ok(await view.focused());
});

req('R202', 'With the new tab setting on Browser default or Custom URL, a new tab goes there instead of to Float.', async (t) => {
  const target = t.server.url('/p/Elsewhere');
  const isFloat = (x) => (x.url || x.pendingUrl || '').includes('palette.html');

  // Control: with the default setting a new tab does become Float's page.
  await syncNewTabCache(t);
  await newTab(t);
  await t.waitFor(async () => (await tabsWhere(t, isFloat)).length > 0, { what: 'default new tab becomes Float' });
  await t.evalSw(async () => {
    for (const x of await chrome.tabs.query({})) if (x.url?.includes('palette.html')) await chrome.tabs.remove(x.id);
  });

  // Custom URL: the tab navigates to the URL.
  await t.settings({ newTab: 'url', newTabUrl: target });
  await syncNewTabCache(t);
  await newTab(t);
  await t.waitFor(async () => (await tabsWhere(t, (x) => (x.url || x.pendingUrl) === target)).length > 0, { what: 'custom URL tab' });
  t.equal((await tabsWhere(t, isFloat)).length, 0, 'no Float tab for a custom URL');
  await t.evalSw(async () => {
    for (const x of await chrome.tabs.query({})) if (x.url?.endsWith('/p/Elsewhere')) await chrome.tabs.remove(x.id);
  });

  // Browser default: the tab is sent to the browser's own new tab page.
  await t.settings({ newTab: 'browser', newTabUrl: '' });
  await syncNewTabCache(t);
  await newTab(t);
  const isBrowser = (x) => /^chrome:\/\/(new-tab-page|newtab)/.test(x.url || x.pendingUrl || '');
  await t.waitFor(async () => (await tabsWhere(t, isBrowser)).length > 0, { what: 'browser new tab page' });
  t.equal((await tabsWhere(t, isFloat)).length, 0, 'no Float tab for the browser default');
});

req('R203', 'Esc on the palette page closes it and returns to the most recently used tab; if it is the window\'s only tab, it stays open with the input cleared.', async (t) => {
  const a = await t.open(t.server.url('/p/TabA'));
  await t.open(t.server.url('/p/TabB'));
  await t.evalSw((id) => chrome.tabs.update(id, { active: true }), a.tabId);
  const view = await t.palettePage('fallback');
  const paletteId = await t.evalSw(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  t.notEqual(paletteId, a.tabId);
  await view.press('Escape');
  await t.waitFor(() => t.evalSw(async (id) => !(await chrome.tabs.get(id).catch(() => null)), paletteId), { what: 'palette tab closed' });
  const active = await t.evalSw(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  t.equal(active, a.tabId, 'returned to the most recently used tab, not just any tab');

  // Only tab in the window: it stays, with the input cleared.
  const only = await t.palettePage('fallback');
  const onlyId = await t.evalSw(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  await t.evalSw(async (id) => {
    for (const x of await chrome.tabs.query({})) if (x.id !== id) await chrome.tabs.remove(x.id);
  }, onlyId);
  await t.waitFor(async () => (await tabsWhere(t, () => true)).length === 1, { what: 'single tab' });
  await only.type('something');
  t.equal(await only.value(), 'something');
  await only.press('Escape');
  await t.waitFor(async () => (await only.value()) === '', { what: 'input cleared' });
  t.ok(await t.evalSw((id) => chrome.tabs.get(id).then(() => true, () => false), onlyId), 'the tab is still open');
  t.ok(await only.focused(), 'input focused again');
});

/** Types an address of a local page, and waits for the Open row for it. */
async function typeAddress(t, view, path) {
  // With the scheme: a bare host would be opened over https.
  await view.type(t.server.url(path));
  await view.waitRows((r) => r.length > 0 && r[0].title.includes(path.slice(3)), 'open row');
}

req('R204', 'On the palette page, Enter opens a non-tab row in the current tab, and Shift+Enter opens it in a new tab.', async (t) => {
  const view = await t.palettePage('fallback');
  const paletteUrl = `${t.EXT}/palette.html?fallback`;
  const before = (await t.env.browser.pages()).length;
  await typeAddress(t, view, '/p/Dest');
  await view.press('Enter');
  await t.waitFor(() => view.page.url().endsWith('/p/Dest'), { what: 'current tab navigated' });
  t.equal((await t.env.browser.pages()).length, before, 'no new tab for Enter');

  // Shift+Enter: a new tab, and the palette page stays where it was.
  const view2 = await t.palettePage('fallback');
  const count = (await t.env.browser.pages()).length;
  await typeAddress(t, view2, '/p/Other');
  await view2.page.keyboard.down('Shift');
  await view2.press('Enter');
  await view2.page.keyboard.up('Shift');
  await t.waitFor(async () => (await t.env.browser.pages()).some((p) => p.url().endsWith('/p/Other')), { what: 'new tab' });
  t.equal(view2.page.url(), paletteUrl, 'the palette page was not navigated');
  t.equal((await t.env.browser.pages()).length, count + 1);
});

req('R205', 'Enter on a tab row from a palette page switches to that tab and closes the palette tab.', async (t) => {
  const target = await t.open(t.server.url('/p/SwitchTarget'));
  const view = await t.palettePage('fallback');
  const paletteId = await t.evalSw(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  await view.type('SwitchTarget');
  const rows = await view.waitRows((r) => r[0]?.title === 'SwitchTarget' && r[0].badge === 'Switch to Tab');
  t.equal(rows[0].badge, 'Switch to Tab');
  await view.press('Enter');
  await t.waitFor(() => t.evalSw(async (id) => !(await chrome.tabs.get(id).catch(() => null)), paletteId), { what: 'palette tab closed' });
  const active = await t.evalSw(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  t.equal(active, target.tabId, 'the target tab is active');
});

req('R206', 'The open-palette command on a Float palette page resets and refocuses that palette instead of opening a tab.', async (t) => {
  await t.open(t.server.url('/p/Something'));
  const view = await t.palettePage('fallback');
  const paletteId = await t.evalSw(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  await view.type('abc');
  await view.eval((root) => root.querySelector('.input').blur());
  t.equal(await view.value(), 'abc');
  t.equal(await view.focused(), false, 'input lost focus');
  const tabsBefore = (await tabsWhere(t, () => true)).length;

  await t.command('open-palette', paletteId);
  await t.waitFor(() => view.focused(), { what: 'input refocused' });
  t.equal(await view.value(), '', 'input reset');
  t.equal((await tabsWhere(t, () => true)).length, tabsBefore, 'no tab opened');
  await view.waitRows((r) => r.some((x) => x.title === 'Something'));
});

req('R207', 'The palette page has no `.pending` class once its first results render.', async (t) => {
  await t.open(t.server.url('/p/Something'));
  const { page } = await t.open(`${t.EXT}/palette.html?fallback`);
  // Record the panel's state on every change, from before the page's scripts run.
  await page.evaluateOnNewDocument(() => {
    window.__states = [];
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      const root = attach.call(this, init);
      new MutationObserver(() => {
        const panel = root.querySelector('.panel');
        if (panel) window.__states.push({ pending: panel.classList.contains('pending'), rows: [...root.querySelectorAll('.row')].filter((r) => !r.hidden).length });
      }).observe(root, { subtree: true, childList: true, attributes: true });
      return root;
    };
  });
  await page.reload();
  const view = new View(page, false);
  await view.ready();
  await view.waitRows((r) => r.length > 0);
  const states = await page.evaluate(() => window.__states);
  t.equal(states[0].pending, true, 'control: the panel starts out pending');
  const firstWithRows = states.find((s) => s.rows > 0);
  t.ok(firstWithRows, 'results rendered');
  t.equal(firstWithRows.pending, false, 'not pending when the first results render');
  t.equal(await view.eval((root) => root.querySelector('.panel').classList.contains('pending')), false);
});

req('R208', '`options.html` opens straight into options mode.', async (t) => {
  // Control: the palette page is not in options mode.
  const plain = await t.palettePage('fallback');
  t.equal(await plain.chip(), null);
  t.equal(await plain.placeholder(), 'Search...');

  const { page } = await t.open(`${t.EXT}/options.html`);
  const view = new View(page, false);
  await view.ready();
  await t.waitFor(async () => (await view.chip()) === 'Float options', { what: 'options chip' });
  t.equal(await view.placeholder(), 'Search options...');
  await view.waitRows((r) => r.length > 1);
});

req('R209', 'Installing Float opens `options.html?welcome`, which shows the welcome box above the options palette.', async (t) => {
  const w = t.env.facts.welcome;
  t.ok(w, 'a welcome tab was opened on install');
  t.equal(w.url, `${t.EXT}/options.html?welcome`);
  t.equal(w.box, 'Welcome to Float');
  t.equal(w.optionsChip, 'Float options');

  // Above: the box ends where the palette begins.
  const { page } = await t.open(`${t.EXT}/options.html?welcome`);
  const view = new View(page, false);
  await view.ready();
  await t.waitFor(() => view.eval((root) => !!root.querySelector('.welcome')), { what: 'welcome box' });
  const { box, panel } = await view.eval((root) => ({
    box: root.querySelector('.welcome').getBoundingClientRect().bottom,
    panel: root.querySelector('.panel').getBoundingClientRect().top,
  }));
  t.ok(box <= panel, `welcome box (bottom ${box}) is above the palette (top ${panel})`);
});
