/** Favicon size in pixels (16px at up to 2x). */
export const ICON_PX = 32;

export type ResultKind = 'tab' | 'bookmark' | 'history' | 'chrome' | 'url' | 'search' | 'options' | 'setting';

/** Editing a setting's text in the bar. */
export interface SettingEdit {
  key: string;
  /** Shown in the bar's chip while editing. */
  label: string;
  /** Current value, prefilled. */
  raw: string;
  placeholder: string;
  /** The color being edited, previewed as it's typed. */
  color?: string;
}

/** A row in the palette's options mode. */
export interface Setting {
  key: string;
  /** What Enter does: flip, step, edit text, open `url`, or open the submenu `key`. */
  control: 'toggle' | 'choice' | 'text' | 'link' | 'menu';
  /** Dimmed and inert; `help` says why. */
  disabled?: boolean;
  /** A submenu's name, shown in the bar's chip. */
  label?: string;
  /** Current value, shown on the right. */
  value: string;
  swatch?: string;
  /** Shown in the footer while the row is selected. */
  help: string;
  /** Enter edits this instead of stepping (e.g. a custom URL). */
  edit?: SettingEdit;
}

export interface Result {
  kind: ResultKind;
  title: string;
  /** Muted text shown after the title. */
  sub: string;
  /** Target URL. For `search` results this is the query text. */
  url: string;
  /** Favicon as base64 RGBA pixels (ICON_PX square), for kinds that show one. */
  icon?: string;
  tabId?: number;
  windowId?: number;
  setting?: Setting;
}

/** Where to open a non-tab result. */
export type Where = 'new' | 'current';

export type Message =
  // palette -> SW, answered with QueryResponse; `options` lists settings (or `menu`'s) instead
  | { type: 'query'; id: number; text: string; options?: boolean; menu?: string }
  | { type: 'older'; id: number; text: string; exclude: string[] } // palette -> SW, answered with QueryResponse
  | { type: 'open'; result: Result; where: Where } // palette -> SW
  | { type: 'set'; key: string; step?: number; value?: string } // palette -> SW, answered once saved
  | { type: 'close' } // palette page -> SW, answered with whether the tab was closed
  // SW -> content script / palette page (answered with true). Carry the empty-query
  // results so the palette is complete in its first visible frame.
  | { type: 'toggle'; results: Result[]; zoom: number }
  | { type: 'focus'; tabId: number; results: Result[] };

export interface QueryResponse {
  id: number;
  results: Result[];
  /** Few matches: worth asking for history older than the index (an `older` message). */
  more?: boolean;
}
