### Float

Float is a Chrome MV3 extension that adds a command palette floating above the page, bindable to Ctrl-T in supported browsers (like Helium). Visually it's a ripoff of Zen browser's palette, which was itself a ripoff of Arc's.

- Float opens instantly, never stutters, is always ready to go and rendered before visible.
- Float is lightweight and has virtually 0 impact on browser performance, even on weaker machines.
- Float is centered horizontally but slightly above the equator vertically (so that it's effectively centered when full-size).
- Float is minimal, simple, and beautiful. Matte finish, rounded corners, nice typography.
- Float searches open tabs, bookmarks, and history, searches the web, opens websites, and opens chrome pages like `flags`.
- Float follows the browser's light/dark mode (Chrome has no theme-color API); users can override colors in options.
- A second shortcut (`open-palette-url`) opens the palette on the current URL; Enter then changes the current page instead of opening a tab.
- **Search tabs / bookmarks / history** rows narrow the palette to one source (a chip in the bar, like bangs; `SCOPES` in `shared/messages.ts`). Which sources are searched at all is a setting (`sources`). Each also has a manifest command (`search-tabs`, `search-bookmarks`, `search-history`) with no default key, so users can bind them in the browser's shortcut settings.
- Settings live inside the palette: searching **Float options** enters options mode (in the overlay too). Esc goes up one level.
- Where the overlay can't run (browser pages, Web Store, some Google sites), Float opens a user-configurable fallback URL (default: its own palette page).

### Stack & commands

Vanilla TypeScript, bundled with esbuild, no runtime dependencies. Add libraries only if they clearly simplify things or improve performance.

- `npm run build` → `dist/` (load unpacked). `npm run watch` for development.
- `npm run typecheck`. Run it and the build after every change.
- `npm test`: the requirement tests (see Testing). Run it before finishing any change.
- `npm run icons` regenerates `src/icons/*.png` from `scripts/icons.mjs`.
- `npm run bangs` refreshes `src/background/bangs.json` from Helium's list. Review the diff before committing; it ships as-is.
- **Releases:** `npm version <patch|minor|major>` then `git push --follow-tags`. `.github/workflows/release.yml` builds the tag, attests it, and publishes the zip.
  - The version lives only in `package.json`; the build writes it into `dist/manifest.json`.
  - The manifest's `key` pins the extension ID to `ielgjbnkjikemadobenfanpmchjjokff`, so settings survive reinstalls. Don't change or remove it.
  - Keep the build reproducible: same tag gives the same `dist/` bytes on any OS. No timestamps, absolute paths, or CRLF in output.

### Architecture

- `src/background/`: service worker.
  - `index.ts`: shortcut command, fallback, message router, actions.
  - `search.ts`: ranking.
  - `options.ts`: the settings rows and changes for the palette's options mode.
  - `history.ts`: in-memory history index.
  - `bangs.ts`: `!bangs`. The bundled `bangs.json` (Helium's list) is copied into `chrome.storage.local` on install/update, one key per trigger.
  - `favicons.ts`
  - `chromePages.ts`
  - `url.ts`
- `src/content/index.ts`: the in-page overlay. A closed shadow root on a `popover="manual"` host (top layer), prebuilt while the page is idle.
- `src/ui/`: the palette view (`palette.ts`, `palette.css`), shared by the overlay and the palette page.
- `src/pages/`:
  - `palette.*`: the new tab override and fallback page. `options.html` is the same page opened in options mode.
  - `welcome.*`: the first-run box above the options palette (`options.html?welcome`, opened on install).
- `src/shared/`: message types, settings (`chrome.storage.sync`), fuzzy scorer.

### Rules learned the hard way

- **The content script runs in every tab.**
  - Keep it tiny: currently ~17.1 KB, budget 20 KB. The budget is deliberate pressure to keep code minimal, not a measured limit (a few KB of parse and memory per tab is negligible); what keeps Float instant is the rules below. Don't raise it casually. The build minifies `palette.css`, which ships inside it.
  - When a palette feature no longer fits, split options mode out of `content.js` and inject it on demand (`chrome.scripting`) instead of raising the budget.
  - No work until idle or opened. It builds the palette on idle, then lays it out once unpainted on a later idle (`warm`), so the first open skips font setup.
  - No caches.
- **Never load extension URLs from page context.** Some sites (e.g. YouTube) block them. Favicons are fetched and decoded by the service worker, sent as base64 RGBA, and drawn synchronously with `putImageData` (decoding in the page is async and slow the first time).
- **No `innerHTML` in shared UI** (Trusted Types). Use constructed stylesheets (page CSP), and stop the overlay's events from reaching the page.
- **Don't add service worker listeners that fire on routine browsing** (`history.onVisited`, `tabs.onUpdated`, …). They wake the worker on every navigation. Catch up lazily when the palette opens instead.
- **Memory must stay bounded.**
  - History index: 5000 entries, LRU.
  - Favicon cache: 300 entries.
  - Everything lives in service worker memory, which is freed when the worker goes idle.
- **`chrome.history.search` scans all history** (tens of ms or more). It's only used in the separate `older` request, whose results are appended below the shown ones. (The exception is the history scope with nothing typed: a text-less search for the newest few entries, which is cheap.)
- **The palette is complete in its first visible frame.** The `toggle`/`focus` messages carry the empty-query results; the overlay renders them and shows in one task. Nothing async between showing and painting. The palette page stays transparent (`.pending`) until its first results render.
- **Rows never reorder after they're shown, and Enter acts on what's visible.** An Enter pressed before results arrive waits for them.
- **Palette page URLs:**
  - Bare `palette.html` means it's the browser's new tab page. It's swapped for `palette.html?tab`, because browsers force address-bar focus on new tab pages; setting `focusNewTab`.
  - The fallback opens `palette.html?fallback`, plus `&scope=<tabs|bookmarks|history>` or `&edit=<url>` when a scope or edit-URL shortcut was used on the restricted page. Only the built-in page gets these, not a custom fallback URL.

### Testing

**Requirements are the spec.** `tests/requirements.md` is a table of behaviors (IDs R1xx.. and constraints C01..), each `auto` (has a test) or `manual`. Tests live in `tests/cases/` as `req('R204', '<the row's exact text>', async (t) => {...})`.

- `npm test` runs the harness's own tests, builds, then runs every test in headless Helium (`node tests/run.mjs R204 R301` for a few; `--headed` to watch). It fails if an `auto` row has no test, a test has no row (or its row is `manual`), a test's copy of the text differs from the row, a test fails, or a test asserts nothing. A subset run prints INCOMPLETE and exits non-zero.
- **Always run `npm test` before finishing a change, and report its result.** It also prints "Requirements changed since HEAD": a human may have edited the table. For each such row, read the row and its test, fix the test if it no longer matches the behavior, then paste the new text into the test. Never copy new text into a test without reading the test.
- **Never change a row's text or status (auto/manual), or delete a row or test, unless the user asked.** If code changes make a row untrue, say so and propose the new text. New behavior gets a new row with a free ID and a test. Report every table change.
- Tests of "never/not" behavior must first show the opposite happening, so they can't pass by accident. Wait on conditions (`waitFor`), not fixed sleeps. Make tabs with `t.open`: puppeteer's `newPage` opens the new tab page, which Float swaps mid-navigation.
- The overlay lives in a closed shadow root; `t.overlay(page)` reaches it. Real browser shortcuts can't be pressed: tests call `runCommand()`/`showPalette()` in the worker (exposed on `globalThis`).

**Ad hoc checking.**

- Drive Helium (`%LOCALAPPDATA%\imput\Helium\Application\chrome.exe`) with `puppeteer-core`, using a throwaway `userDataDir` and `--load-extension=<dist>`. Never use the user's real profile.
- Puppeteer keys can't trigger browser shortcuts. Open the palette by evaluating `showPalette()` in the service worker (exposed on `globalThis` for this). Open new tabs via `chrome.tabs.create({})`.
- Measure on a throttled CPU (`Emulation.setCPUThrottlingRate`, 4x) to see what weak machines see.
- In tests, open the palette page as `palette.html?fallback`. A bare URL gets swapped away.
- On Windows, `chrome.exe --version` opens a window in the running browser. Read the version from the install directory instead.
