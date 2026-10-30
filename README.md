# Float

<img width="824" height="403" alt="image" src="https://github.com/user-attachments/assets/0a2d971d-1e63-4dc9-aa77-e3f8a22e4441" />

A fast, minimal command palette for chromium-based browsers, inspired by Arc and Zen.

Currently supports:
- Web search
- Search bookmarks, history, and open tabs
- Helium-style bangs
- Edit current URL

In browsers that allow it, such as [Helium](https://github.com/imputnet/helium), you can bind it to Ctrl+T.

---

### Install

Float isn't in the Chrome Web Store yet, so you install it as an unpacked extension.

1. Download `float-vX.Y.Z.zip` from the [latest release](https://github.com/ethantheb/float/releases/latest).
2. Optionally, [verify it](#verify-a-release).
3. Extract it to a folder you'll keep. The browser loads the extension from that folder, so don't delete it.
4. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the folder.

To update, download a new release, overwrite the old folder, and hit reload in chrome://extensions.

#### From source

```sh
git clone https://github.com/ethantheb/float.git
cd float
git checkout vX.Y.Z   # or stay on main for the latest code
npm ci
npm run build
```

Then load the `dist/` folder as in step 4 above.

---
#### Configuration

The default shortcut is Alt+T. To change it, go to `chrome://extensions/shortcuts`.

Float options live in the palette. Simply search for "Float options".

---
#### Permissions

Float makes no network requests and sends nothing anywhere. Web searches use your browser's search engine, or the search URL you set in Float's options.

| Permission | Why |
| --- | --- |
| Read and change all your data on all websites | Shows the palette on top of the current page. Float's script is loaded in every page ahead of time so the palette opens instantly; it only adds the palette and doesn't read or change the page. |
| `tabs` | Searches open tabs by title and URL, including browser pages like `chrome://settings`. |
| `bookmarks`, `history` | Searches your bookmarks and history. |
| `favicon` | Shows site icons from the browser's local icon cache. |
| `search` | Runs web searches with your default search engine. |
| `scripting` | Adds the palette to tabs where it isn't running yet: pages still loading, and tabs open since before Float was installed or updated. |
| `storage` | Saves your settings, and a local copy of the bang list (sourced from Helium browser). |

---
#### AI Acknowledgement

Float is developed with substantial help from AI models, as I'm not a web developer and this started
as a personal experiment. I do still direct changes and test extensively.
