/** The manifest command that opens the palette. */
export const OPEN_PALETTE = 'open-palette';

/** Where the browser lets users rebind it. */
export const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

/** The key bound to the palette, or '' if none (another extension may hold the default). */
export async function currentShortcut(): Promise<string> {
  const commands = await chrome.commands.getAll();
  return commands.find((c) => c.name === OPEN_PALETTE)?.shortcut ?? '';
}
