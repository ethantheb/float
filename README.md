# Float

A fast, minimal command palette that floats above the page. Search open tabs, bookmarks, and history, search the web, open websites, and jump to browser pages like `flags`. Inspired by the palettes in Zen and Arc.

Works in Chrome and Chromium-based browsers (version 121+). In browsers that allow it, such as [Helium](https://github.com/imputnet/helium), you can bind it to Ctrl+T.

## Install

Float isn't in the Chrome Web Store yet, so you install it as an unpacked extension. Either download a release or build it yourself.

### From a release

1. Download `float-vX.Y.Z.zip` from the [latest release](https://github.com/ethantheb/float/releases/latest).
2. Optionally, [verify it](#verify-a-release).
3. Extract it to a folder you'll keep. The browser loads the extension from that folder, so don't delete it.
4. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the folder.

### From source

```sh
git clone https://github.com/ethantheb/float.git
cd float
git checkout vX.Y.Z   # or stay on main for the latest code
npm ci
npm run build
```

Then load the `dist/` folder as in step 4 above.

### Set the shortcut

The default shortcut is Alt+T. To change it, open Float's options and click **Change…**, or go to `chrome://extensions/shortcuts`.

## Verify a release

Releases are built from the tagged commit by [GitHub Actions](.github/workflows/release.yml) and come with a signed [build attestation](https://docs.github.com/en/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds) and a `SHA256SUMS` file. The build is reproducible, so building the tag yourself produces the same files.

```sh
gh attestation verify float-vX.Y.Z.zip --repo ethantheb/float
```

## Update

Unpacked extensions don't update automatically. To update:

1. Extract the new release over your existing folder, or `git pull && npm ci && npm run build`.
2. Click the reload button on Float's card in `chrome://extensions`.

The extension ID is fixed (`ielgjbnkjikemadobenfanpmchjjokff`), so your settings carry over even if you move the folder.

## Permissions

Float makes no network requests and sends nothing anywhere. Web searches go through your browser's own search engine.

| Permission | Why |
| --- | --- |
| Read and change all your data on all websites | Shows the palette on top of the current page. |
| `tabs` | Searches and switches between open tabs. |
| `bookmarks`, `history` | Searches your bookmarks and history. |
| `favicon` | Shows site icons from the browser's local icon cache. |
| `search` | Runs web searches with your default search engine. |
| `scripting` | Adds the palette to tabs that were already open when Float was installed or updated. |
| `storage` | Saves your settings. |

## Development

```sh
npm run watch       # rebuild dist/ on change
npm run typecheck
```

To release, run `npm version patch` (or `minor`/`major`) to bump the version and create a tag, then `git push --follow-tags`. The workflow builds and publishes the release.
