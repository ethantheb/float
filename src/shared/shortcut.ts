/** The manifest command that opens the palette. */
export const OPEN_PALETTE = 'open-palette';
/** The manifest command that opens the palette on the current URL, to change this page. */
export const EDIT_URL = 'open-palette-url';

/** Where the browser lets users rebind it. */
export const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

/** The key bound to a command, or '' if none (another extension may hold the default). */
export async function currentShortcut(command = OPEN_PALETTE): Promise<string> {
  const commands = await chrome.commands.getAll();
  return commands.find((c) => c.name === command)?.shortcut ?? '';
}
