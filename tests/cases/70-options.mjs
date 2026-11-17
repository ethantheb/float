import { req } from '../lib/registry.mjs';
import { enterOptions, flush, optionsPage, seen, selectRow, stored, tabsAt, watch } from '../lib/helpers.mjs';

const value = async (view, title) => (await view.rows()).find((r) => r.title === title)?.value;
const waitValue = (view, title, want) => view.waitRows((r) => r.find((x) => x.title === title)?.value === want, `${title} = ${want}`);
const selectAll = (view) =>
  view.eval((root) => {
    const input = root.querySelector('.input');
    input.focus();
    input.select();
  });
const shiftEnter = async (view) => {
  await view.page.keyboard.down('Shift');
  await view.press('Enter');
  await view.page.keyboard.up('Shift');
};
/** The overlay on a fresh web page, open. */
async function openOverlay(t) {
  const { page, tabId } = await t.open(t.server.url('/p/Home'));
  const ov = await t.overlay(page);
  await t.command('open-palette', tabId);
  await t.waitFor(() => ov.isOpen(), { what: 'overlay open' });
  return ov;
}

req('R701', 'Choosing Float options enters options mode: a "Float options" chip, the `Search options...` placeholder, and a help footer for the selected row.', async (t) => {
  const check = async (view, where) => {
    await enterOptions(view);
    t.equal(await view.chip(), 'Float options', `${where}: chip`);
    t.equal(await view.placeholder(), 'Search options...', `${where}: placeholder`);
    t.match(await view.foot(), /^Opens Float over the current page\./, `${where}: footer for the selected Shortcut row`);
    await selectRow(view, 'Theme');
    t.equal(await view.foot(), 'Light, dark, or follow the browser.', `${where}: footer follows the selection`);
  };
  await check(await t.palettePage(), 'palette page');
  await check(await openOverlay(t), 'overlay');
});

req('R702', 'Typing in options mode filters the settings by name and keywords.', async (t) => {
  const v = await optionsPage(t);
  const all = await v.titles();
  t.includes(all, 'Bangs');
  t.includes(all, 'Theme');
  // By name.
  await v.type('bang');
  let titles = await v.waitTitles((x) => x.length < all.length, 'filtered by name');
  t.includes(titles, 'Bangs');
  t.excludes(titles, 'Theme');
  // By a keyword that is not in the name ("dark" is Theme's).
  await selectAll(v);
  await v.type('dark');
  titles = await v.waitTitles((x) => x.includes('Theme') && !x.includes('Bangs'), 'filtered by keyword');
  t.excludes(titles, 'Search URL');
});

req('R703', 'Esc goes up one level at a time (editor, submenu, options, palette, closed), reselecting the submenu row just left.', async (t) => {
  const ov = await openOverlay(t);
  await enterOptions(ov);
  await selectRow(ov, 'Edit colors');
  await ov.press('Enter');
  await t.waitFor(async () => (await ov.chip()) === 'Colors', { what: 'colors submenu' });
  await ov.waitRows((r) => r[0]?.title === 'Background', 'colors');
  await ov.press('Enter');
  await t.waitFor(async () => (await ov.chip()) === 'Background', { what: 'color editor' });

  await ov.press('Escape');
  await t.waitFor(async () => (await ov.chip()) === 'Colors', { what: 'back in the submenu' });
  t.equal((await ov.rows()).find((r) => r.selected)?.title, 'Background', 'the edited row is still selected');

  await ov.press('Escape');
  await t.waitFor(async () => (await ov.chip()) === 'Float options', { what: 'back in options' });
  await ov.waitRows((r) => r.find((x) => x.selected)?.title === 'Edit colors', 'Edit colors reselected');

  await ov.press('Escape');
  await t.waitFor(async () => (await ov.chip()) === null, { what: 'back in the palette' });
  t.equal(await ov.placeholder(), 'Search...');
  t.ok(await ov.isOpen(), 'still open');

  await ov.press('Escape');
  await t.waitFor(async () => !(await ov.isOpen()), { what: 'closed' });
});

req('R704', 'In options mode, Enter flips a toggle, Enter steps a choice forward and Shift+Enter back, and a text setting opens an editor where Enter saves and Esc cancels.', async (t) => {
  const v = await optionsPage(t);
  await watch(t);

  // Toggle.
  await selectRow(v, 'Bangs');
  t.equal(await value(v, 'Bangs'), 'On');
  await v.press('Enter');
  await waitValue(v, 'Bangs', 'Off');
  await v.press('Enter');
  await waitValue(v, 'Bangs', 'On');

  // Choice: forward twice, then back once.
  await selectRow(v, 'Theme');
  t.equal(await value(v, 'Theme'), 'Follow browser');
  await v.press('Enter');
  await waitValue(v, 'Theme', 'Dark');
  await v.press('Enter');
  await waitValue(v, 'Theme', 'Light');
  await shiftEnter(v);
  await waitValue(v, 'Theme', 'Dark');

  // Text: Enter saves.
  await selectRow(v, 'Search URL');
  await v.press('Enter');
  await t.waitFor(async () => (await v.chip()) === 'Search URL', { what: 'editor' });
  t.equal(await v.foot(), 'Enter saves, Esc cancels.');
  await v.type('https://kagi.com/search?q=%s');
  await v.press('Enter');
  await waitValue(v, 'Search URL', 'kagi.com');
  t.equal(await v.chip(), 'Float options', 'the editor closed');
  t.equal(await stored(t, 'searchUrl'), 'https://kagi.com/search?q=%s');

  // Text: Esc cancels.
  await v.press('Enter');
  await t.waitFor(async () => (await v.chip()) === 'Search URL', { what: 'editor again' });
  await v.type('junk');
  await v.press('Escape');
  await t.waitFor(async () => (await v.chip()) === 'Float options', { what: 'editor cancelled' });
  await flush(v);
  t.equal(await value(v, 'Search URL'), 'kagi.com');
  t.deepEqual((await seen(t)).filter((m) => m.key === 'searchUrl').map((m) => m.value), ['https://kagi.com/search?q=%s'], 'only the saved edit was sent');
});

req('R705', 'An invalid color stays in the editor and is not saved.', async (t) => {
  const v = await optionsPage(t);
  await watch(t);
  await selectRow(v, 'Edit colors');
  await v.press('Enter');
  await t.waitFor(async () => (await v.chip()) === 'Colors', { what: 'colors submenu' });
  await v.waitRows((r) => r[0]?.title === 'Background', 'colors');
  await v.press('Enter');
  await t.waitFor(async () => (await v.chip()) === 'Background', { what: 'editor' });

  await v.type('notacolor');
  await v.press('Enter');
  await flush(v);
  t.equal(await v.chip(), 'Background', 'still in the editor');
  t.deepEqual(await seen(t), [], 'nothing was sent to be saved');
  t.equal(await stored(t, 'colors'), undefined, 'nothing is stored');

  // Control: a valid color leaves the editor and is saved.
  await selectAll(v);
  await v.type('tomato');
  await v.press('Enter');
  await t.waitFor(async () => (await v.chip()) === 'Colors', { what: 'editor closed' });
  await t.waitFor(async () => (await stored(t, 'colors'))?.bg === 'tomato', { what: 'color saved' });
});

req('R706', '"Focus palette on new tabs" is dimmed and does nothing unless the new tab page is Float.', async (t) => {
  await watch(t);
  // Control: with Float as the new tab page the row works.
  const on = await optionsPage(t);
  await selectRow(on, 'Focus palette on new tabs');
  const live = (await on.rows()).find((r) => r.title === 'Focus palette on new tabs');
  t.equal(live.disabled, false);
  t.equal(live.value, 'On');
  await on.press('Enter');
  await waitValue(on, 'Focus palette on new tabs', 'Off');
  t.equal(await stored(t, 'focusNewTab'), false);

  await t.settings({ focusNewTab: true, newTab: 'browser' });
  await watch(t);
  const off = await optionsPage(t);
  const row = (await off.rows()).find((r) => r.title === 'Focus palette on new tabs');
  t.equal(row.disabled, true, 'dimmed');
  t.equal(row.value, 'Not used');
  await selectRow(off, 'Focus palette on new tabs');
  await off.press('Enter');
  await flush(off);
  t.deepEqual(await seen(t), [], 'Enter sent nothing');
  t.equal(await stored(t, 'focusNewTab'), true, 'unchanged');
});

req('R707', 'The shortcut rows show the bound key or "Not set", and Enter opens the browser\'s shortcut settings.', async (t) => {
  const bound = await t.evalSw(async () => {
    const all = await chrome.commands.getAll();
    const key = (name) => all.find((c) => c.name === name)?.shortcut || 'Not set';
    return { Shortcut: key('open-palette'), 'Edit URL shortcut': key('open-palette-url') };
  });
  const v = await optionsPage(t);
  const url = 'chrome://extensions/shortcuts';
  for (const [i, title] of ['Shortcut', 'Edit URL shortcut'].entries()) {
    t.equal(await value(v, title), bound[title], `${title} shows what the browser reports`);
    await selectRow(v, title);
    await v.press('Enter');
    await t.waitFor(async () => (await tabsAt(t, url)) === i + 1, { what: `shortcut settings tab ${i + 1}` });
  }
});

req('R708', 'A setting changed in options mode is saved to `chrome.storage.sync` and shows its new value after the palette is closed and reopened.', async (t) => {
  const first = await optionsPage(t);
  t.equal(await stored(t, 'bangs'), undefined, 'not stored before');
  await selectRow(first, 'Bangs');
  await first.press('Enter');
  await waitValue(first, 'Bangs', 'Off');
  t.equal(await stored(t, 'bangs'), false, 'saved to sync storage');
  await first.page.close();

  const second = await optionsPage(t);
  t.equal(await value(second, 'Bangs'), 'Off', 'shown after reopening');
});

req('R709', 'The Startup page row opens the browser\'s on-startup settings in a new tab.', async (t) => {
  const v = await optionsPage(t);
  const url = 'chrome://settings/onStartup';
  t.equal(await tabsAt(t, url), 0);
  await selectRow(v, 'Startup page');
  await v.press('Enter');
  await t.waitFor(async () => (await tabsAt(t, url)) === 1, { what: 'startup settings tab' });
});
