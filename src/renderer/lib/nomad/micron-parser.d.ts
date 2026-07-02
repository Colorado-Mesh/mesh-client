declare module 'micron-parser' {
  export default class MicronParser {
    constructor(darkTheme?: boolean, enableForceMonospace?: boolean);
    convertMicronToHtml(markup: string): string;
    convertMicronToFragment(markup: string): DocumentFragment;
  }
}
