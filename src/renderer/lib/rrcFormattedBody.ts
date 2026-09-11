/**
 * Detect / render NomadNet-style micron (and light markdown) in RRC chat bodies.
 * Micron HTML is DOMPurify-sanitized via renderNomadMicronPage.
 */

import { renderNomadMicronPage } from '@/renderer/lib/nomad/micronParser';

/** Micron control sequences that are meaningless as plain IRC text. */
const MICRON_HINT_RE = /`([!*_=fbacrl<>{}]|[FB]T?[0-9a-fA-F]{3,6}|\[)/;

/** Common markdown cues NomadNet Channels convert before micron render. */
const MARKDOWN_HINT_RE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|__[^_\n]+__|\[[^\]]+\]\([^)]+\))/;

export function rrcBodyLooksFormatted(text: string): boolean {
  return MICRON_HINT_RE.test(text) || MARKDOWN_HINT_RE.test(text);
}

/**
 * Lightweight markdown → micron so the existing micron renderer can format
 * common Channel-style bodies without vendoring NomadNet's MarkdownToMicron.
 */
export function lightMarkdownToMicron(text: string): string {
  // Protect link destinations so emphasis markers inside URLs stay intact.
  const destinations: string[] = [];
  let out = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_m, label: string, url: string) => {
      const i = destinations.length;
      destinations.push(url);
      return `«MDURL${i}»${label}«/MDURL»`;
    },
  );
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '`!$1`!');
  out = out.replace(/__([^_\n]+)__/g, '`!$1`!');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1`*$2`*');
  out = out.replace(/«MDURL(\d+)»([\s\S]*?)«\/MDURL»/g, (_m, idx, label) => {
    const url = destinations[Number(idx)] ?? '';
    return `\`[${label}\`${url}\`]`;
  });
  return out;
}

/** Sanitize + convert an RRC message body to HTML (micron path). */
export function renderRrcFormattedBodyHtml(text: string): string {
  const micron = MARKDOWN_HINT_RE.test(text) ? lightMarkdownToMicron(text) : text;
  return renderNomadMicronPage(micron);
}
