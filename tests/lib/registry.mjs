// Where tests register themselves: req('R101', '<the row's exact text>', async (t) => { ... }).
// The text is a copy of the table row, so rewording the row fails the test until it's reviewed.

export const registry = [];
/** Set by the runner while it imports each case file. */
export const current = { file: '' };

/**
 * `opts.browser: false` runs without launching a browser (static checks on the build output).
 */
export function req(id, text, fn, opts = {}) {
  registry.push({ id, text, fn, browser: opts.browser !== false, file: current.file });
}
