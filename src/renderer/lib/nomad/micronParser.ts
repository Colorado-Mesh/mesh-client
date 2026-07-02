import MicronParser from 'micron-parser';

export const DEFAULT_NOMAD_NODE_PAGE_PATH = '/page/index.mu';

export interface ParsedNomadLink {
  destination_hash: string | null;
  path: string;
}

let darkParser: MicronParser | null = null;

function getMicronParser(): MicronParser {
  darkParser ??= new MicronParser(true);
  return darkParser;
}

/** Returns DOMPurify-sanitized HTML from Micron (.mu) markup. */
export function renderNomadMicronPage(content: string): string {
  return getMicronParser().convertMicronToHtml(content);
}

/** Mount sanitized HTML into a container without assigning innerHTML (XSS check safe). */
export function mountNomadMicronHtml(container: HTMLElement, html: string): void {
  container.replaceChildren();
  if (!html) return;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const node of Array.from(doc.body.childNodes)) {
    container.appendChild(document.importNode(node, true));
  }
}

export function isNomadMicronPage(contentType: string | undefined, path: string): boolean {
  if (contentType === 'micron') return true;
  return path.toLowerCase().endsWith('.mu');
}

export function isNomadFilePath(path: string): boolean {
  return normalizeNomadPagePath(path).startsWith('/file/');
}

function stripNomadUrlSchemes(url: string): string {
  return url.replace(/^nomadnetwork:\/\//, '').replace(/^lxmf:\/\//, '');
}

/** Parse Nomad Network link targets from Micron `data-destination` or anchor href. */
export function parseNomadNetworkLinkUrl(
  url: string,
  defaultPagePath: string = DEFAULT_NOMAD_NODE_PAGE_PATH,
): ParsedNomadLink | null {
  const trimmed = stripNomadUrlSchemes(url.trim());
  if (!trimmed) return null;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return null;
  }

  if (trimmed.startsWith(':')) {
    let path = trimmed.slice(1);
    if (!path) path = defaultPagePath;
    return { destination_hash: null, path: normalizeNomadPagePath(path) };
  }

  if (trimmed.includes(':')) {
    const [destinationHash, ...rest] = trimmed.split(':');
    if (destinationHash.length === 32 && /^[a-fA-F0-9]+$/.test(destinationHash)) {
      return {
        destination_hash: destinationHash.toLowerCase(),
        path: normalizeNomadPagePath(rest.join(':')),
      };
    }
  }

  if (trimmed.length === 32 && /^[a-fA-F0-9]+$/.test(trimmed)) {
    return { destination_hash: trimmed.toLowerCase(), path: defaultPagePath };
  }

  return null;
}

export function normalizeNomadPagePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return DEFAULT_NOMAD_NODE_PAGE_PATH;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function isExternalHttpUrl(url: string): boolean {
  const trimmed = url.trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}
