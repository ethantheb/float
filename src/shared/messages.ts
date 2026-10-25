export type ResultKind = 'tab' | 'bookmark' | 'history' | 'chrome' | 'url' | 'search';

export interface Result {
  kind: ResultKind;
  title: string;
  /** Muted text shown after the title. */
  sub: string;
  /** Target URL. For `search` results this is the query text. */
  url: string;
  /** Favicon as base64 PNG, for kinds that show one. */
  icon?: string;
  tabId?: number;
  windowId?: number;
}

/** Where to open a non-tab result. */
export type Where = 'new' | 'current';

export type Message =
  | { type: 'query'; id: number; text: string } // palette -> SW, answered with QueryResponse
  | { type: 'older'; id: number; text: string; exclude: string[] } // palette -> SW, answered with QueryResponse
  | { type: 'open'; result: Result; where: Where } // palette -> SW
  | { type: 'close' } // palette page -> SW, answered with whether the tab was closed
  | { type: 'toggle' } // SW -> content script
  | { type: 'focus'; tabId: number }; // SW -> palette page, answered with true

export interface QueryResponse {
  id: number;
  results: Result[];
  /** Few matches: worth asking for history older than the index (an `older` message). */
  more?: boolean;
}
