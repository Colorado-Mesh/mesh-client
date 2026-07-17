/** Partial placeholder metadata passed to {@link MicronParser.bindPartials} fetchers. */
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
  static bindPartials(
    root: ParentNode | null | undefined,
    fetcher: (info: MicronPartialInfo) => Promise<MicronPartialFetchResult>,
    options?: { lazy?: boolean },
  ): MicronPartialCleanup;
}
