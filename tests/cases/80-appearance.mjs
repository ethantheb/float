import { req } from '../lib/registry.mjs';

const DARK = 'rgb(28, 28, 28)';
const LIGHT = 'rgb(251, 251, 251)';
const panelColor = (view) => view.eval((root) => getComputedStyle(root.querySelector('.panel')).backgroundColor);
const prefer = (view, scheme) => view.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
const waitColor = async (t, view, want) => {
  await t.waitFor(async () => (await panelColor(view)) === want, { what: `panel color ${want}` });
  t.equal(await panelColor(view), want);
};

req('R801', 'With Theme on Follow browser the palette follows the browser\'s light or dark mode; Light and Dark override it.', async (t) => {
  const v = await t.palettePage();
  // Follow browser (the default).
  await prefer(v, 'light');
  await waitColor(t, v, LIGHT);
  await prefer(v, 'dark');
  await waitColor(t, v, DARK);
  // Overrides win over the browser's mode.
  await t.settings({ theme: 'light' });
  await waitColor(t, v, LIGHT);
  await prefer(v, 'light');
  await t.settings({ theme: 'dark' });
  await waitColor(t, v, DARK);
  // Back to following it.
  await t.settings({ theme: 'auto' });
  await waitColor(t, v, LIGHT);
});

req('R802', 'A color override applies to an already-open palette without a reload.', async (t) => {
  const color = 'rgb(1, 2, 3)';
  // The palette page.
  const v = await t.palettePage();
  await v.page.evaluate(() => (window.sameDocument = true));
  t.notEqual(await panelColor(v), color);
  await t.settings({ colors: { bg: color } });
  await waitColor(t, v, color);
  t.equal(await v.page.evaluate(() => window.sameDocument), true, 'the page was not reloaded');
  await t.settings({ colors: {} });
  await t.waitFor(async () => (await panelColor(v)) !== color, { what: 'override removed' });

  // The overlay, while it is open.
  const { page, tabId } = await t.open(t.server.url('/p/Home'));
  const ov = await t.overlay(page);
  await t.command('open-palette', tabId);
  await t.waitFor(() => ov.isOpen(), { what: 'overlay open' });
  await t.settings({ colors: { bg: color } });
  await waitColor(t, ov, color);
  t.ok(await ov.isOpen(), 'still open');
});
