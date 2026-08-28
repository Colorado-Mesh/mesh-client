import { parseReticulumDestinationInput } from '@/renderer/lib/reticulum/reticulumDestinationInput';

import { parseNomadNetworkLinkUrl } from './micronParser';

/** A Reticulum address detected inside free-form chat text. */
export type ReticulumChatLink =
  | { kind: 'nomadPage'; start: number; end: number; url: string }
  | { kind: 'dm'; start: number; end: number; url: string; destinationHash: string };

/** Hash only; schemes and page paths are sliced off separately to keep this linear. */
const HASH_PATTERN = /[0-9a-fA-F]{32}/gu;

const SCHEMES = ['nomadnetwork://', 'lxmf.delivery@', 'lxmf://', 'lxmf@'] as const;

const TRAILING_PUNCT = /[.,!?;:'"()]+$/;
const HEX_CHAR = /[0-9a-fA-F]/;
/** Characters that mean the match started mid-token rather than at an address boundary. */
const JOINING_CHAR = /[0-9a-zA-Z:/@._-]/;

/** `:/path` run following the hash (up to whitespace), or an empty string. */
function pathAfter(text: string, index: number): string {
  if (!text.startsWith(':/', index)) return '';
  let end = index;
  while (end < text.length && !/\s/.test(text[end])) end += 1;
  return text.slice(index, end);
}

/** Longest known scheme immediately preceding `index`, or an empty string. */
function schemeBefore(text: string, index: number): string {
  const head = text.slice(0, index).toLowerCase();
  for (const scheme of SCHEMES) {
    if (head.endsWith(scheme)) return scheme;
  }
  return '';
}

/** Page links are `hash:/path`; a `nomadnetwork://` prefix implies a page even without a path. */
function isPageCandidate(scheme: string, hashAndPath: string): boolean {
  return scheme === 'nomadnetwork://' || hashAndPath.includes(':/');
}

/**
 * Find Nomad page addresses and LXMF destination hashes in chat text.
 *
 * The two kinds are disambiguated by the `:/path` suffix: `<hash>:/page/index.mu`
 * browses a Nomad page, while a bare (or `lxmf://`-schemed) hash opens a DM.
 */
export function findReticulumChatLinks(text: string): ReticulumChatLink[] {
  const links: ReticulumChatLink[] = [];
  HASH_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HASH_PATTERN.exec(text)) !== null) {
    const scheme = schemeBefore(text, match.index);
    const start = match.index - scheme.length;

    // Reject matches that start mid-token (e.g. inside a longer hex blob or a URL).
    const before = start > 0 ? text[start - 1] : '';
    if (before && JOINING_CHAR.test(before)) continue;

    const path = pathAfter(text, match.index + match[0].length);
    const hashAndPath = `${match[0]}${path}`.replace(TRAILING_PUNCT, '');
    if (!hashAndPath) continue;
    const token = `${text.slice(start, match.index)}${hashAndPath}`;
    const end = start + token.length;

    // Reject a bare hash that continues into more hex (33+ hex chars is not an address).
    const after = end < text.length ? text[end] : '';
    if (after && HEX_CHAR.test(after)) continue;

    if (isPageCandidate(scheme, hashAndPath)) {
      const parsed = parseNomadNetworkLinkUrl(token);
      if (parsed?.destination_hash) {
        links.push({ kind: 'nomadPage', start, end, url: token });
      }
      continue;
    }

    const destinationHash = parseReticulumDestinationInput(token);
    if (destinationHash) {
      links.push({ kind: 'dm', start, end, url: token, destinationHash });
    }
  }
  return links;
}
