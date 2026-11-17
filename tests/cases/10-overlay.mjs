import { req } from '../lib/registry.mjs';

req('R101', 'The open-palette command on a web page shows the overlay above the page with the input focused.', async (t) => {
  const { page, tabId } = await t.open(t.server.url('/p/Home'));
  const ov = await t.overlay(page);
  t.equal(await ov.isOpen(), false, 'closed before the command');
  await t.command('open-palette', tabId);
  await t.waitFor(() => ov.isOpen(), { what: 'overlay open' });
  t.ok(await ov.focused(), 'input is focused');
  // Above the page: it's in the top layer.
  t.ok(await page.evaluate(() => document.querySelector('float-root').matches(':popover-open')));
});

req('R102', 'With nothing typed, the palette lists up to 8 open tabs, most recently used first, leaving out the tab it was opened from.', async (t) => {
  let origin;
  for (let i = 1; i <= 10; i++) {
    origin = await t.open(t.server.url(`/p/Tab${i}`));
    await t.sleep(30);
  }
  const ov = await t.overlay(origin.page);
  await t.command('open-palette', origin.tabId);
  const titles = await ov.waitTitles((x) => x.length > 0, 'rows').then(() => ov.titles());
  t.deepEqual(titles, ['Tab9', 'Tab8', 'Tab7', 'Tab6', 'Tab5', 'Tab4', 'Tab3', 'Tab2']);
});
