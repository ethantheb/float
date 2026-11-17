import { req } from '../lib/registry.mjs';

// ---- helpers ----

const tabs = (t) => t.evalSw(() => chrome.tabs.query({}).then((ts) => ts.map((x) => ({ id: x.id, url: x.url, active: x.active, windowId: x.windowId }))));
const tabUrl = (t, id) => t.evalSw((i) => chrome.tabs.get(i).then((x) => x.url), id);
const bookmark = (t, title, url) => t.evalSw((ti, u) => chrome.bookmarks.create({ parentId: '1', title: ti, url: u }), title, url);

/** Opens the overlay on a tab and waits until it shows with rows. */
async function openOverlay(t, page, tabId, command = 'open-palette') {
  const ov = await t.overlay(page);
  await t.command(command, tabId);
  await t.waitFor(() => ov.isOpen(), { what: 'overlay open' });
  await ov.waitRows((r) => r.length > 0);
  return ov;
}

const closed = (t, ov) => t.waitFor(async () => !(await ov.isOpen()), { what: 'overlay closed' });

/** Holds Ctrl while pressing a key. */
async function ctrl(ov, key) {
  await ov.page.keyboard.down('Control');
  await ov.page.keyboard.press(key);
  await ov.page.keyboard.up('Control');
}

async function withShift(ov, key) {
  await ov.page.keyboard.down('Shift');
  await ov.page.keyboard.press(key);
  await ov.page.keyboard.up('Shift');
}

// ---- tests ----

req('R103', 'Triggering the command the overlay is already open for (open-palette, edit-URL, or the same scope) closes it.', async (t) => {
  const { page, tabId } = await t.open(t.server.url('/p/Home'));
  await t.open(t.server.url('/p/Other'), { active: false });
  const ov = await t.overlay(page);
  for (const command of ['open-palette', 'open-palette-url', 'search-tabs']) {
    await t.command(command, tabId);
    await t.waitFor(() => ov.isOpen(), { what: `${command} opens` });
    t.equal(await ov.isOpen(), true);
    await t.command(command, tabId);
    await closed(t, ov);
    t.equal(await ov.isOpen(), false, `${command} again closes it`);
  }
  // Positive control: the closing above was the toggle, not the overlay refusing to open.
  await t.command('open-palette', tabId);
  await t.waitFor(() => ov.isOpen(), { what: 'opens again' });
});

req('R104', 'Triggering a different command while the overlay is open switches it to that mode instead of closing.', async (t) => {
  const url = t.server.url('/p/Home');
  const { page, tabId } = await t.open(url);
  await t.open(t.server.url('/p/Other'), { active: false });
  const ov = await openOverlay(t, page, tabId);
  t.equal(await ov.chip(), null);
  t.equal(await ov.value(), '');

  await t.command('search-tabs', tabId);
  await t.waitFor(async () => (await ov.chip()) === 'Tabs', { what: 'tabs scope' });
  t.ok(await ov.isOpen());

  await t.command('open-palette-url', tabId);
  await t.waitFor(async () => (await ov.value()) === url, { what: 'edit-URL mode' });
  t.equal(await ov.chip(), null);
  t.ok(await ov.isOpen());

  await t.command('open-palette', tabId);
  await t.waitFor(async () => (await ov.value()) === '' && (await ov.waitTitles((x) => x.length > 0)).includes('Other'), { what: 'plain mode' });
  t.ok(await ov.isOpen());
});

req('R105', 'Esc with no chip closes the overlay and returns focus to the page element that had it.', async (t) => {
  const { page, tabId } = await t.open(t.server.url('/keys'));
  await page.focus('#i');
  const ov = await openOverlay(t, page, tabId);
  t.ok(await ov.focused(), 'input is in the palette');

  // Positive control: with a chip, Esc only removes the chip.
  await t.command('search-tabs', tabId);
  await t.waitFor(async () => (await ov.chip()) === 'Tabs');
  await ov.press('Escape');
  await t.waitFor(async () => (await ov.chip()) === null, { what: 'chip removed' });
  t.ok(await ov.isOpen(), 'still open after Esc with a chip');

  await ov.press('Escape');
  await closed(t, ov);
  t.equal(await page.evaluate(() => document.activeElement.id), 'i');
});

req('R106', 'Clicking outside the panel closes the overlay.', async (t) => {
  const { page, tabId } = await t.open(t.server.url('/p/Home'));
  await t.open(t.server.url('/p/Other'), { active: false });
  const ov = await openOverlay(t, page, tabId);
  const panel = await ov.eval((root) => {
    const r = root.querySelector('.search').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  // Positive control: a click on the panel's search icon keeps it open.
  await page.mouse.click(panel.x, panel.y);
  t.ok(await ov.isOpen(), 'a click inside the panel does not close it');
  await page.mouse.click(5, 5);
  await closed(t, ov);
});

req('R107', "Keys typed in the overlay don't reach the page's own bubbling key listeners, such as site hotkeys.", async (t) => {
  const { page, tabId } = await t.open(t.server.url('/keys'));
  // Ordinary (bubbling) key listeners, like a site's hotkeys.
  await page.evaluate(() => {
    window.bubbled = [];
    for (const type of ['keydown', 'keyup', 'keypress']) {
      addEventListener(type, (e) => bubbled.push(e.key));
      document.addEventListener(type, (e) => bubbled.push(e.key));
    }
  });
  await page.focus('#i');
  await page.keyboard.press('q');
  t.includes(await page.evaluate(() => window.bubbled), 'q', 'control: the page listener sees keys typed in the page');
  await page.evaluate(() => (window.bubbled.length = 0));

  const ov = await openOverlay(t, page, tabId);
  await ov.type('hello');
  await ov.press('ArrowDown', 'ArrowUp', 'Backspace', 'k', 'Tab');
  t.equal(await ov.value(), 'hellk', 'the palette did receive the keys');
  // Closed by a click: the Esc key-up would land on the page once focus returns to it.
  await page.mouse.click(5, 5);
  await closed(t, ov);
  t.deepEqual(await page.evaluate(() => window.bubbled), [], 'page saw no keys');
});

req('R108', 'In the overlay, Enter opens a non-tab row in a new tab, and Shift+Enter opens it in the current tab.', async (t) => {
  const target = t.server.url('/p/Marked', 'bm.example.test');
  await bookmark(t, 'Marked', target);
  // A page that is open is listed as its tab, so the second half needs a bookmark that was never opened.
  const target2 = t.server.url('/p/Starred', 'bm.example.test');
  await bookmark(t, 'Starred', target2);
  const homeUrl = t.server.url('/p/Home');

  // Enter: a new tab; the current tab stays where it was.
  const a = await t.open(homeUrl);
  const before = (await tabs(t)).length;
  let ov = await openOverlay(t, a.page, a.tabId);
  await ov.type('Marked');
  await ov.waitRows((r) => r[0]?.title === 'Marked' && r[0].badge === '');
  await ov.press('Enter');
  await t.waitFor(async () => (await tabs(t)).length === before + 1, { what: 'a new tab' });
  await t.waitFor(async () => (await tabs(t)).some((x) => x.id !== a.tabId && x.url === target), { what: 'the bookmark in the new tab' });
  t.equal(await tabUrl(t, a.tabId), homeUrl, 'the current tab is untouched');

  // Shift+Enter: the current tab navigates; no new tab.
  const b = await t.open(homeUrl);
  const count = (await tabs(t)).length;
  ov = await openOverlay(t, b.page, b.tabId);
  await ov.type('Starred');
  await ov.waitRows((r) => r[0]?.title === 'Starred' && r[0].badge === '');
  await withShift(ov, 'Enter');
  await t.waitFor(async () => (await tabUrl(t, b.tabId)) === target2, { what: 'current tab navigates' });
  t.equal((await tabs(t)).length, count, 'no new tab');
});

req('R109', 'Enter on a tab row switches to that tab and focuses its window, whatever Shift does.', async (t) => {
  const origin = await t.open(t.server.url('/p/Home'));
  const farUrl = t.server.url('/p/Far');
  const farState = (win) => t.evalSw((tid, w) => Promise.all([chrome.tabs.get(tid), chrome.windows.get(w)]).then(([tab, win]) => tab.active && win.focused), win.tabId, win.id);

  for (const key of ['Enter', 'Shift+Enter']) {
    // A fresh window each time, so it starts unfocused, holding the target tab.
    const win = await t.evalSw((u) => chrome.windows.create({ url: u, focused: false }).then((w) => ({ id: w.id, tabId: w.tabs[0].id })), farUrl);
    await t.waitFor(async () => (await t.evalSw((i) => chrome.tabs.get(i), win.tabId)).title === 'Far', { what: 'far tab loaded' });
    await t.evalSw((o) => chrome.tabs.update(o, { active: true }), origin.tabId);
    const count = (await tabs(t)).length;
    t.equal(await farState(win), false, 'control: the far tab starts inactive in an unfocused window');

    const ov = await openOverlay(t, origin.page, origin.tabId);
    const rows = await ov.waitRows((r) => r.some((x) => x.title === 'Far'));
    t.equal(rows.find((x) => x.title === 'Far').badge, 'Switch to Tab');
    // Select the Far row (arrow keys), then confirm.
    for (let n = 0; n < rows.findIndex((x) => x.title === 'Far'); n++) await ov.press('ArrowDown');
    await (key === 'Enter' ? ov.press(key) : withShift(ov, 'Enter'));
    await t.waitFor(() => farState(win), { what: `${key} switches to the far tab and focuses its window` });
    t.equal((await tabs(t)).length, count, `${key} opens no tab`);
    await t.evalSw((w) => chrome.windows.remove(w), win.id);
  }
});

req('R110', "The edit-URL command on a web page opens the overlay with the page's URL selected and no tab results, and Enter navigates that page.", async (t) => {
  const url = t.server.url('/p/Home');
  const next = t.server.url('/p/Next');
  await t.open(t.server.url('/p/Other'), { active: false });
  const { page, tabId } = await t.open(url);

  // Positive control: the plain palette lists the other tab.
  let ov = await openOverlay(t, page, tabId);
  t.includes(await ov.titles(), 'Other');
  await ov.press('Escape');
  await closed(t, ov);

  await t.command('open-palette-url', tabId);
  await t.waitFor(() => ov.isOpen());
  await t.waitFor(async () => (await ov.value()) === url, { what: 'URL in the bar' });
  const sel = await ov.eval((root) => {
    const i = root.querySelector('.input');
    return [i.selectionStart, i.selectionEnd, i.value.length];
  });
  t.deepEqual(sel, [0, url.length, url.length], 'the whole URL is selected');
  const rows = await ov.rows();
  t.ok(rows.length > 0);
  t.ok(rows.every((r) => r.badge === '' && r.title !== 'Other'), 'no tab rows');

  const count = (await tabs(t)).length;
  await ov.type(next);
  await ov.press('Enter');
  await t.waitFor(async () => (await tabUrl(t, tabId)) === next, { what: 'page navigates' });
  t.equal((await tabs(t)).length, count, 'no new tab');
});

req('R111', 'The arrow keys, Tab, Ctrl+N/J and Ctrl+P/K move the selection and wrap at both ends; clicking a row opens it.', async (t) => {
  const tabsOpened = [];
  for (const name of ['T1', 'T2', 'T3']) tabsOpened.push(await t.open(t.server.url(`/p/${name}`)));
  const origin = await t.open(t.server.url('/p/Home'));
  const ov = await openOverlay(t, origin.page, origin.tabId);
  t.deepEqual(await ov.titles(), ['T3', 'T2', 'T1', 'about:blank']);
  const sel = async () => (await ov.rows()).findIndex((r) => r.selected);
  const step = async (action, expected) => {
    await action();
    t.equal(await sel(), expected);
  };
  t.equal(await sel(), 0);
  await step(() => ov.press('ArrowDown'), 1);
  await step(() => ov.press('ArrowDown'), 2);
  await step(() => ov.press('Tab'), 3);
  await step(() => ov.press('ArrowDown'), 0); // wraps at the bottom
  await step(() => ov.press('ArrowUp'), 3); // wraps at the top
  await step(() => ov.press('ArrowUp'), 2);
  await step(() => withShift(ov, 'Tab'), 1);
  await step(() => ctrl(ov, 'n'), 2);
  await step(() => ctrl(ov, 'j'), 3);
  await step(() => ctrl(ov, 'n'), 0);
  await step(() => ctrl(ov, 'p'), 3);
  await step(() => ctrl(ov, 'k'), 2);
  await step(() => ctrl(ov, 'k'), 1);
  await step(() => ctrl(ov, 'k'), 0);
  await step(() => ctrl(ov, 'k'), 3);

  // Clicking a row opens it (these are tabs, so it switches to the clicked one: T1).
  const at = await ov.eval((root) => {
    const r = root.querySelectorAll('.row')[2].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await origin.page.mouse.click(at.x, at.y);
  await t.waitFor(async () => (await tabs(t)).find((x) => x.id === tabsOpened[0].tabId)?.active, { what: 'clicked tab active' });
  await closed(t, ov);
});

req('R112', 'Enter pressed right after typing acts on the results for the full typed text, not on rows shown earlier.', async (t) => {
  const early = t.server.url('/p/Early', 'a.example.test');
  const full = t.server.url('/p/Full', 'b.example.test');
  await bookmark(t, 'Quokka', early);
  await bookmark(t, 'Quokka Zebra Special', full);
  const { page, tabId } = await t.open(t.server.url('/p/Home'));
  const ov = await openOverlay(t, page, tabId);

  // The rows for the first part are on screen, with a different top row than the full text will have.
  await ov.type('Quokka');
  const shown = await ov.waitRows((r) => r[0]?.title === 'Quokka');
  t.equal(shown[0].title, 'Quokka');

  // Type the rest and press Enter in the same task, so the new results cannot have arrived yet.
  const count = (await tabs(t)).length;
  await ov.eval((root) => {
    const input = root.querySelector('.input');
    input.value = 'Quokka Zebra';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  await t.waitFor(async () => (await tabs(t)).length === count + 1, { what: 'a tab opens' });
  await t.waitFor(async () => (await tabs(t)).some((x) => x.url === full || x.url === early), { what: 'its URL' });
  const urls = (await tabs(t)).map((x) => x.url);
  t.includes(urls, full, 'opened the result for the full text');
  t.excludes(urls, early, 'did not open the earlier top row');
});

req('R113', 'The overlay opens fully styled, with no errors, on a page that requires Trusted Types and has a strict style policy.', async (t) => {
  await t.open(t.server.url('/p/Other'), { active: false });
  const { page, tabId } = await t.open(t.server.url('/csp'));

  // Positive control: the policy is in force (the page's own inline style and innerHTML are refused).
  const policy = await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = 'p{color:rgb(255,0,0)}';
    document.head.append(s);
    let htmlBlocked = false;
    try {
      document.body.innerHTML = '<b>x</b>';
    } catch {
      htmlBlocked = true;
    }
    return { styled: getComputedStyle(document.querySelector('p')).color === 'rgb(255, 0, 0)', htmlBlocked };
  });
  t.equal(policy.styled, false, 'inline styles are blocked on this page');
  t.equal(policy.htmlBlocked, true, 'Trusted Types is enforced on this page');

  const problems = [];
  page.on('console', (m) => m.type() === 'error' && /Content Security|Trusted Type|Refused|violat/i.test(m.text()) && problems.push(m.text()));
  const ov = await openOverlay(t, page, tabId);
  t.includes(await ov.titles(), 'Other');
  t.ok(await ov.focused(), 'input focused');
  const look = await ov.eval((root) => {
    const p = root.querySelector('.panel');
    const r = p.getBoundingClientRect();
    const cs = getComputedStyle(p);
    const row = getComputedStyle(root.querySelector('.row:not([hidden])'));
    return { w: r.width, h: r.height, radius: cs.borderRadius, bg: cs.backgroundColor, rowDisplay: row.display };
  });
  t.ok(look.w > 300 && look.h > 40, `panel has a real size (${look.w}x${look.h})`);
  t.equal(look.radius, '12px');
  t.notEqual(look.bg, 'rgba(0, 0, 0, 0)');
  t.equal(look.rowDisplay, 'flex');
  t.deepEqual(problems, [], 'no CSP / Trusted Types violations');
});

req('R114', 'Opening the overlay makes no `chrome-extension://` requests from the page.', async (t) => {
  await t.open(t.server.url('/p/Other'), { active: false });
  await bookmark(t, 'Marked', t.server.url('/p/Marked', 'bm.example.test'));
  const { page, tabId } = await t.open(t.server.url('/p/Home'));
  const seen = [];
  page.on('request', (r) => seen.push(r.url()));

  // Positive control: the observer sees ordinary requests and extension ones.
  await page.evaluate((u) => fetch(u).catch(() => {}), t.server.url('/p/ping'));
  await page.evaluate((e) => fetch(`${e}/palette.html`, { mode: 'no-cors' }).catch(() => {}), t.EXT);
  await t.waitFor(() => seen.some((u) => u.endsWith('/p/ping')) && seen.some((u) => u.startsWith('chrome-extension://')), { what: 'observer sees both kinds' });
  seen.length = 0;

  const ov = await openOverlay(t, page, tabId);
  await ov.type('Marked');
  await ov.waitRows((r) => r[0]?.title === 'Marked');
  await ov.press('Escape', 'Escape');
  await closed(t, ov);
  t.deepEqual(seen.filter((u) => u.startsWith('chrome-extension://')), []);
});
