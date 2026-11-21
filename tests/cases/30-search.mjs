import { req } from '../lib/registry.mjs';
import { bare as bareUrl, discard } from '../lib/helpers.mjs';

const displayOf = bareUrl;

// The palette page lists the same results as the overlay, and is the easiest place to test search.

const SEARCH_SUB = 'Search the web';

/** Clears the input, types `text`, and returns the rows once they are the results for that text (`marker` finds its action row). */
async function ask(v, text, marker = (r) => r.sub === SEARCH_SUB && r.title === text.trim()) {
  await v.page.bringToFront();
  const old = await v.value();
  await v.press(...Array(old.length).fill('Backspace'));
  await v.type(text);
  return v.waitRows((rows) => rows.some(marker), `results for "${text}"`);
}

/** Like ask, but retypes until `pred` holds: history is caught up in the background when the palette opens. */
async function askUntil(v, text, pred) {
  for (let i = 0; i < 8; i++) {
    const rows = await ask(v, text);
    if (pred(rows)) return rows;
    await v.page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
  }
  return ask(v, text);
}

/** Visits a local page with the given title, then closes its tab, leaving it in history only. */
async function visit(t, url, title) {
  const { page, tabId } = await t.open(url);
  await page.evaluate((x) => (document.title = x), title);
  await t.waitFor(
    () => t.evalSw(async (u, x) => (await chrome.history.search({ text: x, startTime: 0, maxResults: 50 })).some((h) => h.url === u && h.title === x), url, title),
    { what: 'history title' },
  );
  await t.evalSw((id) => chrome.tabs.remove(id), tabId);
}

const bookmark = (t, title, url) => t.evalSw((ti, u) => chrome.bookmarks.create({ title: ti, url: u }), title, url);
const addHistory = (t, url) => t.evalSw((u) => chrome.history.addUrl({ url: u }), url);
const titlesOf = (rows) => rows.map((r) => r.title);
const kindRow = (rows, sub) => rows.findIndex((r) => r.sub === sub);

req('R301', 'Typed words match tabs, bookmarks and history by title or URL; every word must match, in any order.', async (t) => {
  await t.open(t.server.url('/p/Quokka%20Tab'));
  await bookmark(t, 'Quokka Mark', 'https://bm.example.test/walrus');
  await addHistory(t, 'https://hist.example.test/narwhal');
  await visit(t, t.server.url('/p/Quokka%20Hist', 'h2.example.test'), 'Quokka Hist');
  const v = await t.palettePage();

  // By title, one word per source.
  const byTitle = await askUntil(v, 'quokka', (r) => ['Quokka Tab', 'Quokka Mark', 'Quokka Hist'].every((x) => titlesOf(r).includes(x)));
  for (const x of ['Quokka Tab', 'Quokka Mark', 'Quokka Hist']) t.includes(titlesOf(byTitle), x);

  // By title, words in any order.
  t.includes(titlesOf(await ask(v, 'tab quokka')), 'Quokka Tab');
  t.includes(titlesOf(await ask(v, 'quokka tab')), 'Quokka Tab');
  t.includes(titlesOf(await ask(v, 'mark quokka')), 'Quokka Mark');

  // By URL, in any order, for a bookmark and a history page that only has a URL.
  t.includes(titlesOf(await ask(v, 'walrus bm')), 'Quokka Mark');
  t.includes(titlesOf(await ask(v, 'bm walrus')), 'Quokka Mark');
  const hist = await askUntil(v, 'narwhal hist', (r) => titlesOf(r).includes('hist.example.test/narwhal'));
  t.includes(titlesOf(hist), 'hist.example.test/narwhal');
  t.includes(titlesOf(await ask(v, 'hist narwhal')), 'hist.example.test/narwhal');

  // Every word must match: only the bookmark's title has both "quokka" and "mark".
  const both = titlesOf(await ask(v, 'quokka mark'));
  t.includes(both, 'Quokka Mark');
  t.excludes(both, 'Quokka Tab');
  t.excludes(both, 'Quokka Hist');
});

req('R302', 'A typed abbreviation of three or more letters matches letters in order, so `gthb` finds github.com.', async (t) => {
  await bookmark(t, 'Code host', 'https://github.com/');
  const v = await t.palettePage();
  t.includes(titlesOf(await ask(v, 'gthb')), 'Code host');
  // Two letters are too few to count as an abbreviation.
  t.excludes(titlesOf(await ask(v, 'gb')), 'Code host');
});

req('R303', 'A page that is both open and in history or bookmarks is listed once, as the tab.', async (t) => {
  const url = t.server.url('/p/Dup');
  await t.open(url);
  await bookmark(t, 'Dup bookmark', url);
  // Control: a page that is only in history is listed.
  await visit(t, t.server.url('/p/Dup', 'other.example.test'), 'Dup');
  const v = await t.palettePage();
  const rows = await askUntil(v, 'dup', (r) => titlesOf(r).filter((x) => x === 'Dup').length >= 2);
  // Two "Dup" rows: the open tab, and the history-only page on the other host. Not three, and no bookmark row.
  t.equal(titlesOf(rows).filter((x) => x === 'Dup').length, 2);
  t.excludes(titlesOf(rows), 'Dup bookmark');
  t.equal(rows.filter((r) => r.title === 'Dup' && r.badge === 'Switch to Tab').length, 1, 'the open page is the tab row');
});

req('R304', 'An unloaded or discarded tab whose title is empty or just its URL or host, at no well-known site and with no title known from history or bookmarks, is titled with its URL.', async (t) => {
  const bare = await t.open(t.server.url('/untitled'));
  await t.open(t.server.url('/p/Fancy'));
  // Only tabs that aren't loaded get a fallback title (see R322).
  const tab = await discard(t, bare.tabId);
  t.match(tab.title, /^$|example\.test.*\/untitled/, 'the browser gives this tab no real title');
  const v = await t.palettePage();
  const rows = await ask(v, 'example');
  // Control: a titled tab shows its title.
  t.includes(titlesOf(rows), 'Fancy');
  // The subtitle is hidden when it repeats the title.
  const named = rows.find((r) => r.badge === 'Switch to Tab' && [r.title, r.sub].some((x) => x.endsWith('/untitled')));
  t.equal(named?.title, bareUrl(t.server.url('/untitled')));
});

req('R322', 'A loaded tab is titled as the browser titles it, even when that is just its URL or domain; only unloaded or discarded tabs get a fallback title.', async (t) => {
  const bare = await t.open(t.server.url('/untitled'));
  await t.evalSw((u) => chrome.bookmarks.create({ title: 'Bookmarked', url: u }), t.server.url('/untitled'));
  await t.open(t.server.url('/p/Fancy'));
  const v = await t.palettePage();
  // The subtitle is hidden when it repeats the title.
  const row = async (text) => (await ask(v, text)).find((r) => r.badge === 'Switch to Tab' && [r.title, r.sub].some((x) => x.endsWith('/untitled')));
  const loaded = await t.evalSw((id) => chrome.tabs.get(id), bare.tabId);
  t.equal(loaded.status, 'complete', 'the tab is loaded');
  t.equal((await row('untitle'))?.title, loaded.title || loaded.url.replace(/^https?:\/\//, ''), "loaded: the browser's own title");
  await discard(t, bare.tabId);
  t.equal((await row('untitled'))?.title, 'Bookmarked', "discarded: the fallback, the bookmark's title");
});

req('R323', "An unloaded or discarded tab at a well-known site, with no title of its own or from history or bookmarks, is titled with the site's name, such as Gmail for mail.google.com.", async (t) => {
  // Makes an untitled background tab at `url`, optionally bookmarked as `bookmark`, then discards it.
  const untitledTab = async (url, bookmark) => {
    const { id } = await t.evalSw((u) => chrome.tabs.create({ url: u, active: false }), url);
    const loaded = await t.waitFor(async () => {
      const tab = await t.evalSw((i) => chrome.tabs.get(i), id);
      return tab.status === 'complete' && tab;
    }, { what: `${url} to load` });
    if (bookmark) await t.evalSw((ti, u) => chrome.bookmarks.create({ title: ti, url: u }), bookmark, loaded.url);
    return discard(t, id);
  };
  const other = await untitledTab(t.server.url('/untitled'));
  const gmail = await untitledTab(`http://mail.google.com:${t.server.port}/untitled`);
  const marked = await untitledTab(`http://mail.google.com:${t.server.port}/untitled/marked`, 'Inbox (3)');
  const v = await t.palettePage();
  const rows = (await ask(v, 'untitled')).filter((r) => r.badge === 'Switch to Tab');
  // The subtitle is hidden when it repeats the title.
  const titleOf = (tab) => rows.find((r) => r.sub === displayOf(tab.url) || (r.sub === '' && r.title === displayOf(tab.url)))?.title;
  t.equal(titleOf(other), displayOf(other.url), 'control: another site is titled with its URL');
  t.equal(titleOf(gmail), 'Gmail');
  t.equal(titleOf(marked), 'Inbox (3)', 'a bookmark title comes first: the name is only a fallback');
});

req("R324", "A history page titled only with its site's name, such as `Example` or `(3) Example` on example.test, at a URL other than the homepage, is listed after the homepage and pages with real titles, even when visited more often.", async (t) => {
  const page = (path, host) => t.server.url(path, host);
  await visit(t, page('/p/Guide'), 'Example guide');
  await visit(t, page('/'), 'Example');
  await visit(t, page('/p/One?v=1'), 'Example');
  await visit(t, page('/p/Two'), '(3) Example');
  // Control: the same title on another site is a real title, and visited as often.
  await visit(t, page('/p/Three', 'www.other.test'), 'Example');
  for (const url of [page('/p/One?v=1'), page('/p/Two'), page('/p/Three', 'www.other.test')]) for (let i = 0; i < 5; i++) await addHistory(t, url);

  const v = await t.palettePage();
  const at = (rows, path, host) => rows.findIndex((r) => r.sub === bareUrl(page(path, host)));
  const all = [['/p/Guide'], ['/'], ['/p/One?v=1'], ['/p/Two'], ['/p/Three', 'www.other.test']];
  const rows = await askUntil(v, 'example', (r) => all.every(([p, h]) => at(r, p, h) >= 0));
  const [guide, home, one, two, other] = all.map(([p, h]) => at(rows, p, h));
  t.ok(guide >= 0 && home >= 0 && one >= 0 && two >= 0 && other >= 0, 'every page is listed');
  t.ok(other < guide, 'control: a well-visited page titled Example on another site outranks the guide');
  for (const [name, i] of [['Example', one], ['(3) Example', two]]) {
    t.ok(i > guide, `${name} is listed after the page with a real title`);
    t.ok(i > home, `${name} is listed after the homepage`);
  }
});

req('R305', 'A pinned tab shows a pin icon over its favicon, and its badge still says "Switch to Tab".', async (t) => {
  await t.open(t.server.url('/p/Loose'));
  await t.open(t.server.url('/p/Fixed'), { pinned: true });
  const v = await t.palettePage();
  const rows = await v.waitRows((r) => ['Loose', 'Fixed'].every((x) => titlesOf(r).includes(x)));
  const fixed = rows.find((r) => r.title === 'Fixed');
  t.equal(fixed.pinned, true, 'pin icon shown');
  t.equal(fixed.badge, 'Switch to Tab');
  // Control: an unpinned tab has no pin.
  t.equal(rows.find((r) => r.title === 'Loose').pinned, false);
});

req('R306', 'An open tab at `https://a..com/` does not stop the palette from opening or searching.', async (t) => {
  await t.evalSw(() => chrome.tabs.create({ url: 'https://a..com/', active: false }));
  await t.open(t.server.url('/p/Third'));
  const origin = await t.open(t.server.url('/p/Origin'));
  const ov = await t.overlay(origin.page);
  await t.command('open-palette', origin.tabId);
  await t.waitFor(() => ov.isOpen(), { what: 'overlay open' });
  await ov.waitTitles((x) => x.includes('Third'), 'tab rows with nothing typed');
  await ov.type('third');
  const titles = await ov.waitTitles((x) => x.includes('third') && x.includes('Third'), 'results for the typed text');
  t.includes(titles, 'Third');
});

req('R307', 'A long title or URL is cut with an ellipsis, the URL first, and neither overlaps the "Switch to Tab" badge.', async (t) => {
  await t.open(t.server.url('/p/Tiny'));
  await t.open(t.server.url(`/p/Short?q=${'a'.repeat(300)}`));
  await t.open(t.server.url(`/p/${encodeURIComponent('Long '.repeat(40).trim())}`));
  const v = await t.palettePage();
  await v.waitRows((r) => ['Tiny', 'Short'].every((x) => titlesOf(r).includes(x)) && r.some((x) => x.title.startsWith('Long')));
  const cuts = await v.eval((root) =>
    Object.fromEntries(
      [...root.querySelectorAll('.row')]
        .filter((r) => !r.hidden && r.querySelector('.badge') && !r.querySelector('.badge').hidden)
        .map((r) => {
          const title = r.querySelector('.title');
          const sub = [...r.querySelectorAll('.text .sub')].at(-1);
          const cut = (e) => e.scrollWidth > e.clientWidth;
          return [
            title.textContent.slice(0, 5),
            { title: cut(title), sub: cut(sub), ellipsis: getComputedStyle(title).textOverflow + '/' + getComputedStyle(sub).textOverflow },
          ];
        }),
    ),
  );
  // Control: nothing is cut when both fit.
  t.deepEqual([cuts.Tiny.title, cuts.Tiny.sub], [false, false]);
  // A long URL is cut while the title stays whole.
  t.deepEqual([cuts.Short.title, cuts.Short.sub], [false, true], 'the URL is cut first');
  // A long title is cut too.
  t.equal(cuts['Long '].title, true);
  t.equal(cuts['Long '].ellipsis, 'ellipsis/ellipsis');
  // Where the text visibly ends: a child sticking out of a container that clips is cut off there.
  const ends = await v.eval((root) =>
    [...root.querySelectorAll('.row')]
      .filter((r) => !r.hidden && r.querySelector('.badge') && !r.querySelector('.badge').hidden)
      .map((r) => {
        const text = r.querySelector('.text');
        const box = text.getBoundingClientRect();
        const clips = getComputedStyle(text).overflowX !== 'visible';
        const right = Math.max(...[...text.children].filter((c) => !c.hidden).map((c) => (clips ? Math.min(c.getBoundingClientRect().right, box.right) : c.getBoundingClientRect().right)));
        return { title: r.querySelector('.title').textContent.slice(0, 10), right, badgeLeft: r.querySelector('.badge').getBoundingClientRect().left };
      }),
  );
  t.ok(ends.length >= 3);
  for (const e of ends) t.ok(e.right <= e.badgeLeft, `${e.title}: text ends at ${e.right}, badge starts at ${e.badgeLeft}`);
});

req('R308', 'No more than 8 rows are shown, including the search or open row.', async (t) => {
  for (let i = 1; i <= 12; i++) await bookmark(t, `Item ${i}`, `https://bm${i}.example.test/`);
  const v = await t.palettePage();
  const rows = await ask(v, 'item');
  t.equal(rows.length, 8, 'full: 7 bookmarks and the search row');
  t.equal(rows.filter((r) => r.sub === SEARCH_SUB).length, 1);
  // Same for the Open row.
  await v.press(...Array(4).fill('Backspace'));
  const open = await ask(v, 'item.example.test', (r) => r.sub === 'Open');
  t.ok(open.length <= 8);
});

req('R309', 'URL-like text such as `example.com` or `localhost:3000` shows an Open row.', async (t) => {
  const v = await t.palettePage();
  const isOpen = (title) => (r) => r.sub === 'Open' && r.title === title;
  t.ok((await ask(v, 'example.com', isOpen('example.com'))).some(isOpen('example.com')));
  t.ok((await ask(v, 'localhost:3000', isOpen('localhost:3000'))).some(isOpen('localhost:3000')));
  // Control: plain words get no Open row.
  t.ok(!(await ask(v, 'plain words')).some((r) => r.sub === 'Open'));
});

req('R310', 'Other text shows a web search row.', async (t) => {
  const v = await t.palettePage();
  const rows = await ask(v, 'hello world');
  t.equal(rows.find((r) => r.sub === SEARCH_SUB)?.title, 'hello world');
  // Control: URL-like text gets an Open row instead.
  t.ok(!(await ask(v, 'example.com', (r) => r.sub === 'Open')).some((r) => r.sub === SEARCH_SUB));
});

req('R311', 'With a Search URL set, Enter on a search row opens that URL with the query encoded; with none set, the browser\'s default search is used.', async (t) => {
  const tabOf = (v) => t.evalSw(async () => (await chrome.tabs.query({})).find((x) => (x.url || '').includes('palette.html'))?.id);
  const expected = t.server.url('/p/Result?q=a%20b%26c');
  await t.settings({ searchUrl: t.server.url('/p/Result?q=%s') });
  const v = await t.palettePage();
  const rows = await ask(v, 'a b&c', (r) => r.title === 'a b&c');
  t.equal(rows[0].title, 'a b&c');
  t.equal(rows[0].selected, true);
  await v.press('Enter');
  await t.waitFor(() => v.page.url() === expected, { what: `navigation to ${expected}` });
  t.equal(v.page.url(), expected);

  // With none set, Enter hands the text to the browser's default search engine, which leaves the palette.
  await t.settings({ searchUrl: '' });
  const v2 = await t.palettePage();
  const id = await tabOf(v2);
  await ask(v2, 'zzqqxx');
  await v2.press('Enter');
  const url = await t.waitFor(
    async () => {
      const tab = await t.evalSw((i) => chrome.tabs.get(i), id);
      const u = tab.pendingUrl || tab.url || '';
      return u && !u.includes('palette.html') ? u : '';
    },
    { what: 'default search navigation' },
  );
  t.match(url, /zzqqxx/, 'the default search engine got the query');
  t.ok(!url.startsWith(t.server.url('/')), 'not the Search URL template');
});

req('R312', 'Typing an exact browser page name such as `flags`, or a `chrome://` prefix, puts that page above the search row; a partial name keeps the search row first.', async (t) => {
  const v = await t.palettePage();
  let rows = await ask(v, 'flags');
  t.equal(rows[0].sub, 'chrome://flags');
  t.ok(kindRow(rows, SEARCH_SUB) > 0);

  rows = await ask(v, 'chrome://fl', (r) => r.sub === 'Open');
  t.match(rows[0].sub, /^chrome:\/\//);
  t.ok(kindRow(rows, 'Open') > 0);

  // A partial name does not outrank the search row, though the page is still listed.
  rows = await ask(v, 'flag');
  t.equal(rows[0].sub, SEARCH_SUB);
  t.ok(kindRow(rows, 'chrome://flags') > 0);
});

req('R313', 'A prefix of two or more characters of an open tab\'s or bookmark\'s title or URL ranks it above the search row.', async (t) => {
  await t.open(t.server.url('/p/Pangolin%20Page', 'tabhost.example.test'));
  await t.open(t.server.url('/p/Big%20Wombat'));
  await bookmark(t, 'Xylophone Mark', 'https://bmhost.example.test/x');
  const v = await t.palettePage();
  const above = async (text, title) => {
    const rows = await ask(v, text);
    t.equal(rows[0].title, title, `"${text}" puts ${title} first`);
    t.ok(kindRow(rows, SEARCH_SUB) > 0);
  };
  await above('pan', 'Pangolin Page'); // tab title
  await above('tabho', 'Pangolin Page'); // tab URL
  await above('xylo', 'Xylophone Mark'); // bookmark title
  await above('bmho', 'Xylophone Mark'); // bookmark URL

  // Controls: one character, or a match inside the title, does not outrank the search row.
  t.equal((await ask(v, 'x'))[0].sub, SEARCH_SUB);
  const middle = await ask(v, 'wom');
  t.equal(middle[0].sub, SEARCH_SUB);
  t.includes(titlesOf(middle), 'Big Wombat');
});

req('R314', 'A history page that matches only by title stays below the search row; one whose URL starts with the text ranks above it.', async (t) => {
  await visit(t, t.server.url('/p/Plain', 'titleonly.example.test'), 'Gadolinium');
  await visit(t, t.server.url('/p/Other', 'urlfirst.example.test'), 'Unrelated');
  const v = await t.palettePage();
  const byTitle = await askUntil(v, 'gado', (r) => titlesOf(r).includes('Gadolinium'));
  t.equal(byTitle[0].sub, SEARCH_SUB, 'search row first');
  t.ok(titlesOf(byTitle).indexOf('Gadolinium') > 0);
  const byUrl = await askUntil(v, 'urlfi', (r) => titlesOf(r).includes('Unrelated'));
  t.equal(byUrl[0].title, 'Unrelated', 'history page first');
  t.ok(kindRow(byUrl, SEARCH_SUB) > 0);
});

req('R315', 'A page visited since the palette last opened appears in history results the next time it opens.', async (t) => {
  const first = await t.palettePage();
  // Control: before the visit, it is not there (and the history index is loaded).
  t.excludes(titlesOf(await ask(first, 'newpage')), 'fresh.example.test/newpage');
  await first.page.close();
  await addHistory(t, 'https://fresh.example.test/newpage');
  const second = await t.palettePage();
  t.includes(titlesOf(await askUntil(second, 'newpage', (r) => titlesOf(r).includes('fresh.example.test/newpage'))), 'fresh.example.test/newpage');
});

req('R316', 'A history page that was deleted never appears in results.', async (t) => {
  const url = 'https://gone.example.test/vanish';
  await addHistory(t, url);
  const first = await t.palettePage();
  // Control: it is found while it is in history.
  t.includes(titlesOf(await askUntil(first, 'vanish', (r) => titlesOf(r).includes('gone.example.test/vanish'))), 'gone.example.test/vanish');
  await first.page.close();
  await t.evalSw((u) => chrome.history.deleteUrl({ url: u }), url);
  const second = await t.palettePage();
  const rows = await ask(second, 'vanish');
  t.excludes(titlesOf(rows), 'gone.example.test/vanish');
  // Older history (the browser's own search) comes later; it must not bring it back either.
  await t.evalSw(() => new Promise((r) => setTimeout(r, 500)));
  t.excludes(await second.titles(), 'gone.example.test/vanish');
});

req('R317', 'A bookmark added while the palette is closed appears in the next search.', async (t) => {
  const first = await t.palettePage();
  t.excludes(titlesOf(await ask(first, 'latecomer')), 'Latecomer Mark');
  await first.page.close();
  await bookmark(t, 'Latecomer Mark', 'https://late.example.test/');
  const second = await t.palettePage();
  t.includes(titlesOf(await ask(second, 'latecomer')), 'Latecomer Mark');
});

req('R318', 'Float\'s own pages never appear as history or bookmark results.', async (t) => {
  const own = `${t.EXT}/palette.html?fallback&x=ownpage`;
  await addHistory(t, own);
  await addHistory(t, 'https://ownpage.example.test/');
  await bookmark(t, 'Ownpage Float Mark', own);
  await bookmark(t, 'Ownpage Normal Mark', 'https://ownpage2.example.test/');
  t.ok(await t.evalSw(async (u) => (await chrome.history.search({ text: 'ownpage', startTime: 0, maxResults: 20 })).some((h) => h.url === u), own), 'the own page is in history');
  const v = await t.palettePage();
  const rows = await askUntil(v, 'ownpage', (r) => titlesOf(r).includes('ownpage.example.test'));
  // Controls: an ordinary history page and bookmark are listed.
  t.includes(titlesOf(rows), 'ownpage.example.test');
  t.includes(titlesOf(rows), 'Ownpage Normal Mark');
  t.excludes(titlesOf(rows), 'Ownpage Float Mark');
  t.ok(!rows.some((r) => r.sub.includes('palette.html') || r.title.includes('palette.html')));
});

req('R319', 'Typing `settings` lists Float options, below chrome://settings.', async (t) => {
  const v = await t.palettePage();
  const rows = await ask(v, 'settings');
  const chrome = kindRow(rows, 'chrome://settings');
  const options = rows.findIndex((r) => r.title === 'Float options');
  t.ok(chrome >= 0, 'chrome://settings listed');
  t.ok(options >= 0, 'Float options listed');
  t.ok(options > chrome);
});

req('R320', 'The Float options row shows only its title, with no secondary text.', async (t) => {
  const v = await t.palettePage();
  const rows = await ask(v, 'settings');
  // Control: the browser page row beside it does have secondary text.
  t.equal(rows.find((r) => r.title === 'settings' && r.sub !== SEARCH_SUB)?.sub, 'chrome://settings');
  const options = rows.find((r) => r.title === 'Float options');
  t.ok(options, 'Float options listed');
  t.equal(options.sub, '');
});
