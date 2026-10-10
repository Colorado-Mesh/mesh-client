/** Partial placeholder metadata passed to the page-scoped partial controller. */
export interface MicronPartialInfo {
  url: string | null;
  destination: string;
  descriptor: string;
  refresh: number;
  fields: string[];
  id: string | null;
  element: HTMLElement;
  signal: AbortSignal | null;
}

export type MicronPartialFetchResult = string | Node | { markup: string } | null | undefined;

export type MicronPartialCleanup = (() => void) & {
  reload?: (predicate?: (info: MicronPartialInfo) => boolean) => void;
};

export default class MicronParser {
  constructor(darkTheme?: boolean, enableForceMonospace?: boolean);
  convertMicronToHtml(markup: string): string;
  convertMicronToFragment(markup: string): DocumentFragment;
}
