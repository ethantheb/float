import { View, waitFor } from '../lib/harness.mjs';
import { req } from '../lib/registry.mjs';

/** A bang's site name and search template, from the list the extension installed. */
const bangData = (t, trigger) => t.evalSw(async (k) => (await chrome.storage.local.get(k))[k], `b:${trigger}`);

/** Types `!<trigger> ` and waits for it to become a chip. */
async function enterBang(view, trigger) {
  await view.type(`!${trigger} `);
  await waitFor(async () => (await view.chip()) !== null, { what: 'bang chip' });
}

req('R401', 'A bang followed by a space (`!g `) becomes a chip named for the site, and the only row searches that site for the rest of the text.', async (t) => {
  const [name] = await bangData(t, 'g');
  // Something else that would match "rust", so "the only row" means something.
  await t.open(t.server.url('/p/Rust-guide'));
  const view = await t.palettePage('fallback');

  await enterBang(view, 'g');
  t.equal(await view.chip(), name);
  t.equal(await view.value(), '', 'the bang left the input');
  await view.type('rust');
  const rows = await view.waitRows((r) => r.length === 1 && r[0].title === 'rust');
  t.equal(rows[0].sub, `Search ${name}`);
});

req('R402', 'A trailing bang (`rust !g`) puts a search of that site first, with no chip.', async (t) => {
  const [name] = await bangData(t, 'g');
  await t.open(t.server.url('/p/Rust-guide'));
  const view = await t.palettePage('fallback');
  await view.type('rust !g');
  const rows = await view.waitRows((r) => r.some((x) => x.sub === `Search ${name}`));
  t.equal(rows[0].title, 'rust');
  t.equal(rows[0].sub, `Search ${name}`, 'the bang search is first');
  t.equal(await view.chip(), null);
  t.equal(await view.value(), 'rust !g', 'the text stays as typed');
});

req('R403', 'Enter on a bang row opens the site\'s search URL; a bang with no search terms opens the site.', async (t) => {
  // A bang pointing at the local server, so the destination can be observed.
  const base = t.server.url('/');
  await t.evalSw((b) => chrome.storage.local.set({ 'b:tst': ['Testsite', `${b}p/{searchTerms}`] }), base);
  try {
    const tabUrl = (tabId) => t.evalSw((id) => chrome.tabs.get(id).then((x) => x.url || x.pendingUrl), tabId);
    const palette = async () => {
      const { page, tabId } = await t.open(`${t.EXT}/palette.html?fallback`);
      const view = new View(page, false);
      await view.ready();
      return { view, tabId };
    };

    const withTerms = await palette();
    await enterBang(withTerms.view, 'tst');
    await withTerms.view.type('rust lang');
    await withTerms.view.waitRows((r) => r[0]?.title === 'rust lang' && r[0].sub === 'Search Testsite');
    await withTerms.view.press('Enter');
    await t.waitFor(async () => (await tabUrl(withTerms.tabId)) === t.server.url('/p/rust%20lang'), { what: 'tab to open the bang search URL' });
    t.equal(await tabUrl(withTerms.tabId), t.server.url('/p/rust%20lang'));

    const bare = await palette();
    await enterBang(bare.view, 'tst');
    await bare.view.waitRows((r) => r[0]?.title === 'Testsite');
    await bare.view.press('Enter');
    await t.waitFor(async () => (await tabUrl(bare.tabId)) === base, { what: 'tab to open the site itself' });
    t.equal(await tabUrl(bare.tabId), base);
  } finally {
    await t.evalSw(() => chrome.storage.local.remove('b:tst'));
  }
});

req('R404', 'With Bangs off, or for an unknown bang, a bang is an ordinary web search.', async (t) => {
  const [name] = await bangData(t, 'g');
  t.equal(await t.evalSw(async () => (await chrome.storage.local.get('b:nosuchbangxyz'))['b:nosuchbangxyz']), undefined, 'the unknown bang really is unknown');

  // Control: with Bangs on, a known bang is not an ordinary search.
  const on = await t.palettePage('fallback');
  await on.type('rust !g');
  await on.waitRows((r) => r[0]?.sub === `Search ${name}`);

  const ordinary = async (view, text) => {
    await view.type(text);
    const rows = await view.waitRows((r) => r.some((x) => x.title === text));
    t.equal(rows[0].title, text);
    t.equal(rows[0].sub, 'Search the web');
    t.equal(await view.chip(), null);
  };

  // An unknown bang, with Bangs on.
  await ordinary(await t.palettePage('fallback'), '!nosuchbangxyz rust');

  // A known bang, with Bangs off: leading and trailing.
  await t.settings({ bangs: false });
  await ordinary(await t.palettePage('fallback'), '!g rust');
  await ordinary(await t.palettePage('fallback'), 'rust !g');
});
