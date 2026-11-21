# Float requirements

One behavior per row, in the form the user would see it. Status is exactly `auto` or `manual`.

- `auto`: must have a test, `req('<ID>', '<this exact behavior text>', ...)`. If the text here changes, the
  test fails until it is reviewed and its copy of the text is updated.
- `manual`: checked by a person; never has a test. Changing a row between `auto` and `manual` is a
  deliberate act to report, never a way to dodge a failing test.
- IDs are permanent: never renumber or reuse one. Add new rows in a free number of the right section.

## Overlay (R1xx)

| ID | Behavior | Status |
| --- | --- | --- |
| R101 | The open-palette command on a web page shows the overlay above the page with the input focused. | auto |
| R102 | With nothing typed, the palette lists up to 8 open tabs, most recently used first, leaving out the tab it was opened from. | auto |
| R103 | Triggering the command the overlay is already open for (open-palette, edit-URL, or the same scope) closes it. | auto |
| R104 | Triggering a different command while the overlay is open switches it to that mode instead of closing. | auto |
| R105 | Esc with no chip closes the overlay and returns focus to the page element that had it. | auto |
| R106 | Clicking outside the panel closes the overlay. | auto |
| R107 | Keys typed in the overlay don't reach the page's own bubbling key listeners, such as site hotkeys. | auto |
| R108 | In the overlay, Enter opens a non-tab row in a new tab, and Shift+Enter opens it in the current tab. | auto |
| R109 | Enter on a tab row switches to that tab and focuses its window, whatever Shift does. | auto |
| R110 | The edit-URL command on a web page opens the overlay with the page's URL selected and no tab results, and Enter navigates that page. | auto |
| R111 | The arrow keys, Tab, Ctrl+N/J and Ctrl+P/K move the selection and wrap at both ends; clicking a row opens it. | auto |
| R112 | Enter pressed right after typing acts on the results for the full typed text, not on rows shown earlier. | auto |
| R113 | The overlay opens fully styled, with no errors, on a page that requires Trusted Types and has a strict style policy. | auto |
| R114 | Opening the overlay makes no `chrome-extension://` requests from the page. | auto |
| R115 | The overlay is complete in its first visible frame, with no flicker or rows reordering. | manual |
| R116 | The overlay is the same size at any page zoom. | manual |
| R117 | Favicons appear in overlay rows on pages that block extension URLs, such as YouTube. | manual |
| R118 | The real browser keys (Ctrl-T and any bound scope or edit-URL shortcut) open the palette. | manual |

## Palette page and new tab (R2xx)

| ID | Behavior | Status |
| --- | --- | --- |
| R201 | A new tab with default settings becomes `palette.html?tab` with the input focused. | auto |
| R202 | With the new tab setting on Browser default or Custom URL, a new tab goes there instead of to Float. | auto |
| R203 | Esc on the palette page closes it and returns to the most recently used tab; if it is the window's only tab, it stays open with the input cleared. | auto |
| R204 | On the palette page, Enter opens a non-tab row in the current tab, and Shift+Enter opens it in a new tab. | auto |
| R205 | Enter on a tab row from a palette page switches to that tab and closes the palette tab. | auto |
| R206 | The open-palette command on a Float palette page resets and refocuses that palette instead of opening a tab. | auto |
| R207 | The palette page has no `.pending` class once its first results render. | auto |
| R208 | `options.html` opens straight into options mode. | auto |
| R209 | Installing Float opens `options.html?welcome`, which shows the welcome box above the options palette. | auto |
| R210 | The palette page fades in when its results arrive late, and is already visible when they arrive first. | manual |

## Search (R3xx)

| ID | Behavior | Status |
| --- | --- | --- |
| R301 | Typed words match tabs, bookmarks and history by title or URL; every word must match, in any order. | auto |
| R302 | A typed abbreviation of three or more letters matches letters in order, so `gthb` finds github.com. | auto |
| R303 | A page that is both open and in history or bookmarks is listed once, as the tab. | auto |
| R304 | An unloaded or discarded tab whose title is empty or just its URL or host, at no well-known site and with no title known from history or bookmarks, is titled with its URL. | auto |
| R305 | A pinned tab shows a pin icon over its favicon, and its badge still says "Switch to Tab". | auto |
| R306 | An open tab at `https://a..com/` does not stop the palette from opening or searching. | auto |
| R307 | A long title or URL is cut with an ellipsis, the URL first, and neither overlaps the "Switch to Tab" badge. | auto |
| R308 | No more than 8 rows are shown, including the search or open row. | auto |
| R309 | URL-like text such as `example.com` or `localhost:3000` shows an Open row. | auto |
| R310 | Other text shows a web search row. | auto |
| R311 | With a Search URL set, Enter on a search row opens that URL with the query encoded; with none set, the browser's default search is used. | auto |
| R312 | Typing an exact browser page name such as `flags`, or a `chrome://` prefix, puts that page above the search row; a partial name keeps the search row first. | auto |
| R313 | A prefix of two or more characters of an open tab's or bookmark's title or URL ranks it above the search row. | auto |
| R314 | A history page that matches only by title stays below the search row; one whose URL starts with the text ranks above it. | auto |
| R315 | A page visited since the palette last opened appears in history results the next time it opens. | auto |
| R316 | A history page that was deleted never appears in results. | auto |
| R317 | A bookmark added while the palette is closed appears in the next search. | auto |
| R318 | Float's own pages never appear as history or bookmark results. | auto |
| R319 | Typing `settings` lists Float options, below chrome://settings. | auto |
| R320 | The Float options row shows only its title, with no secondary text. | auto |
| R321 | Older history that arrives late is added below the rows already shown, which never move. | manual |
| R322 | A loaded tab is titled as the browser titles it, even when that is just its URL or domain; only unloaded or discarded tabs get a fallback title. | auto |
| R323 | An unloaded or discarded tab at a well-known site, with no title of its own or from history or bookmarks, is titled with the site's name, such as Gmail for mail.google.com. | auto |
| R324 | A history page titled only with its site's name, such as `Example` or `(3) Example` on example.test, at a URL other than the homepage, is listed after the homepage and pages with real titles, even when visited more often. | auto |
| R325 | Another browser's scheme for its pages, such as `helium://flags` or `brave://fl`, is read as `chrome://`: it lists that browser page above the search row, and Enter opens it. | auto |

## Bangs (R4xx)

| ID | Behavior | Status |
| --- | --- | --- |
| R401 | A bang followed by a space (`!g `) becomes a chip named for the site, and the only row searches that site for the rest of the text. | auto |
| R402 | A trailing bang (`rust !g`) puts a search of that site first, with no chip. | auto |
| R403 | Enter on a bang row opens the site's search URL; a bang with no search terms opens the site. | auto |
| R404 | With Bangs off, or for an unknown bang, a bang is an ordinary web search. | auto |

## Scopes (R5xx)

| ID | Behavior | Status |
| --- | --- | --- |
| R501 | Typing "search tabs", "search bookmarks" or "search history" offers a row that enters that scope. | auto |
| R502 | In a scope, a chip names the source, the placeholder reads `Search <source>...`, and only that source's items are listed: no search or open row, browser pages, Float options or Search rows. | auto |
| R503 | In the tabs scope with nothing typed, tabs are listed most recently used first. | auto |
| R504 | In the bookmarks scope with nothing typed, the most recently added bookmarks are listed first. | auto |
| R505 | In the history scope with nothing typed, the most recently visited pages are listed first, leaving out the page the palette was opened from. | auto |
| R506 | Esc in a scope or bang chip removes the chip and searches the typed text normally. | auto |
| R507 | Backspace with the caret at the start of the input removes a scope or bang chip and keeps the typed text. | auto |
| R508 | The Search tabs, bookmarks and history rows show only a title, with no secondary text. | auto |
| R509 | The manifest has search-tabs, search-bookmarks and search-history commands with no default key. | auto |
| R510 | A scope command opens the palette in that scope. | auto |
| R511 | Pressing a scope command again after leaving that scope with Esc enters the scope instead of closing. | auto |
| R512 | The scope commands and the edit-URL command work on browser pages by opening the fallback page. | auto |

## Search sources (R6xx)

| ID | Behavior | Status |
| --- | --- | --- |
| R601 | Search sources lists Tabs, Pinned tabs, Bookmarks, History and Browser pages, each On by default. | auto |
| R602 | A source turned off contributes no results, with nothing typed or with text typed. | auto |
| R603 | A source turned off has no Search row; Search tabs stays while either Tabs or Pinned tabs is on. | auto |
| R604 | Opening a scope whose source is off shows one dimmed row, `Tabs is disabled in Float options` (likewise Bookmarks and History); Enter on it does nothing. For Tabs, both Tabs and Pinned tabs must be off. | auto |
| R605 | With History off, tab titles are never taken from history; with Bookmarks off, never from bookmarks. | auto |
| R606 | In incognito, the history scope shows `History is not searched in incognito` and never regular history. | auto |
| R607 | Incognito windows never search history, and incognito tabs never take their titles from it. | manual |
| R608 | Favicons for incognito tabs are never cached, so they don't outlive the window; bookmark favicons are still cached. | manual |
| R609 | Tabs and Pinned tabs step through On, When typed and Off; Bookmarks, History and Browser pages toggle On and Off. | auto |
| R610 | A tab source set to When typed is left out of the list shown with nothing typed, but its tabs are still found by typing and listed in the tabs scope. | auto |

## Options (R7xx)

| ID | Behavior | Status |
| --- | --- | --- |
| R701 | Choosing Float options enters options mode: a "Float options" chip, the `Search options...` placeholder, and a help footer for the selected row. | auto |
| R702 | Typing in options mode filters the settings by name and keywords. | auto |
| R703 | Esc goes up one level at a time (editor, submenu, options, palette, closed), reselecting the submenu row just left. | auto |
| R704 | In options mode, Enter flips a toggle, Enter steps a choice forward and Shift+Enter back, and a text setting opens an editor where Enter saves and Esc cancels. | auto |
| R705 | An invalid color stays in the editor and is not saved. | auto |
| R706 | "Focus palette on new tabs" is dimmed and does nothing unless the new tab page is Float. | auto |
| R707 | The shortcut rows show the bound key or "Not set", and Enter opens the browser's shortcut settings. | auto |
| R708 | A setting changed in options mode is saved to `chrome.storage.sync` and shows its new value after the palette is closed and reopened. | auto |
| R709 | The Startup page row opens the browser's on-startup settings in a new tab. | auto |
| R710 | The Startup page row copies Float's address to the clipboard first. | manual |

## Appearance (R8xx)

| ID | Behavior | Status |
| --- | --- | --- |
| R801 | With Theme on Follow browser the palette follows the browser's light or dark mode; Light and Dark override it. | auto |
| R802 | A color override applies to an already-open palette without a reload. | auto |

## Fallback page (R9xx)

| ID | Behavior | Status |
| --- | --- | --- |
| R901 | The open-palette command on a browser page (`chrome://version`, the Web Store) opens `palette.html?fallback` in a new tab. | auto |
| R902 | With a Fallback URL set, that URL opens instead, without scope or edit parameters. | auto |
| R903 | The fallback page opened with `scope=<key>` starts in that scope. | auto |
| R904 | The fallback page ignores an unknown or inherited scope name such as `constructor`, opening unscoped with no error. | auto |
| R905 | The fallback page opened with `edit=<url>` starts with that URL in the bar and no tab results. | auto |
| R906 | The edit-URL command on one of Float's own pages refocuses that palette in normal mode and opens no tab. | auto |
| R907 | In incognito, the fallback opens the browser's new tab page, or a website Fallback URL. | manual |
| R908 | On the fallback page opened by the edit-URL command on a browser page, Enter changes that browser page's tab, switches to it, and closes the fallback page. | auto |

## Constraints (Cxx)

Checked without a browser, from the build output.

| ID | Behavior | Status |
| --- | --- | --- |
| C01 | `content.js` is at most 20,480 bytes. | auto |
| C02 | No built script uses an HTML-parsing sink (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `DOMParser`, `srcdoc`). | auto |
| C03 | The service worker registers no listener that fires on routine browsing (`history.onVisited`, `tabs.onUpdated`, `tabs.onActivated`, `webNavigation`). | auto |
| C04 | The manifest `key` is present and unchanged. | auto |
