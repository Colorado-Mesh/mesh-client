import type { NomadPageRequestData } from '@/shared/nomad-types';

import MicronParser, {
  type MicronPartialCleanup,
  type MicronPartialFetchResult,
  type MicronPartialInfo,
} from './vendor/micron-parser.js';

export type { MicronPartialCleanup, MicronPartialFetchResult, MicronPartialInfo };
export { MicronParser };

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

export interface NomadMicronPartialPageResult {
  ok: boolean;
  content?: string;
  error?: string;
}

/**
 * Resolve a Micron partial destination and fetch/render its content.
 * Failure point: sidecar/page fetch fails or destination is invalid.
 * Fallback: throw so bindPartials records data-partial-error on the placeholder.
 */
export async function loadNomadMicronPartial(options: {
  destination: string;
  fields: string[];
  signal: AbortSignal | null;
  defaultPagePath: string;
  selectedHash: string;
  formContainer: HTMLElement | null;
  fetchPage: (
    hash: string,
    path: string,
    requestData?: Record<string, string>,
  ) => Promise<NomadMicronPartialPageResult>;
}): Promise<{ markup: string }> {
  const { destination, fields, signal, defaultPagePath, selectedHash, formContainer, fetchPage } =
    options;

  let parsed = parseNomadNetworkLinkUrl(destination, defaultPagePath);
  if (!parsed && destination.trim().startsWith('/')) {
    parsed = {
      destination_hash: null,
      path: normalizeNomadPagePath(destination),
    };
  }
  if (!parsed) {
    throw new Error('invalid_partial_destination');
  }

  const fieldsSpec = parseNomadLinkFieldsSpec(
    fields.filter((entry) => !entry.startsWith('pid=')).join('|'),
  );
  const requestData = formContainer
    ? collectNomadFormFieldValues(formContainer, fieldsSpec)
    : {
        ...Object.fromEntries(
          Object.entries(fieldsSpec.requestVars).map(([k, v]) => [`var_${k}`, v]),
        ),
      };

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const hash = parsed.destination_hash ?? selectedHash;
  const res = await fetchPage(
    hash,
    parsed.path,
    Object.keys(requestData).length > 0 ? requestData : undefined,
  );

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  if (!res.ok || res.content == null) {
    throw new Error(res.error || 'partial_fetch_failed');
  }

  return { markup: renderNomadMicronPage(res.content) };
}

/** Bind Micron partial placeholders; rebinds nested partials after each load. */
export function bindNomadMicronPartials(
  root: HTMLElement,
  fetcher: (info: MicronPartialInfo) => Promise<MicronPartialFetchResult>,
): MicronPartialCleanup {
  const nestedCleanups: (() => void)[] = [];

  const bindRoot = (scope: ParentNode): MicronPartialCleanup => {
    const cleanup = MicronParser.bindPartials(scope, fetcher);
    nestedCleanups.push(cleanup);
    return cleanup;
  };

  const topCleanup = bindRoot(root);

  const onPartialLoaded = (event: Event) => {
    const el = event.target;
    if (!(el instanceof HTMLElement) || !el.classList.contains('Mu-partial')) return;
    if (!root.contains(el)) return;
    bindRoot(el);
  };
  root.addEventListener('partial-loaded', onPartialLoaded);

  const cleanup: MicronPartialCleanup = () => {
    root.removeEventListener('partial-loaded', onPartialLoaded);
    for (const nested of nestedCleanups.splice(0).reverse()) {
      nested();
    }
  };
  cleanup.reload = topCleanup.reload;
  return cleanup;
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

export interface ParsedNomadLinkFieldsSpec {
  /** Named fields to submit, or `*` for all inputs in the page. */
  fieldNames: string[] | '*';
  /** Static request variables (`var_*` on the NomadNet wire). */
  requestVars: Record<string, string>;
}

/** Split a Micron link destination into base URL and optional backtick field spec. */
export function splitNomadLinkDestination(destination: string): {
  baseDestination: string;
  embeddedFieldsSpec: string;
} {
  const idx = destination.indexOf('`');
  if (idx === -1) {
    return { baseDestination: destination, embeddedFieldsSpec: '' };
  }
  return {
    baseDestination: destination.slice(0, idx),
    embeddedFieldsSpec: destination.slice(idx + 1),
  };
}

/** Parse `data-fields` or embedded backtick field metadata from Micron links. */
export function parseNomadLinkFieldsSpec(fieldsSpec: string): ParsedNomadLinkFieldsSpec {
  const trimmed = fieldsSpec.trim();
  if (!trimmed) {
    return { fieldNames: [], requestVars: {} };
  }

  const fieldNames: string[] = [];
  const requestVars: Record<string, string> = {};
  let allFields = false;

  for (const entry of trimmed.split('|')) {
    if (entry === '*') {
      allFields = true;
    } else if (entry.includes('=')) {
      const eqIdx = entry.indexOf('=');
      const key = entry.slice(0, eqIdx);
      const value = entry.slice(eqIdx + 1);
      if (key) requestVars[key] = value;
    } else if (entry) {
      fieldNames.push(entry);
    }
  }

  return {
    fieldNames: allFields ? '*' : fieldNames,
    requestVars,
  };
}

function mergeNomadRequestVars(
  target: Record<string, string>,
  source: Record<string, string>,
): void {
  for (const [key, value] of Object.entries(source)) {
    target[`var_${key}`] = value;
  }
}

/** Collect Micron form field values for a Nomad link request (NomadNet `field_*` keys). */
export function collectNomadFormFieldValues(
  container: HTMLElement,
  fieldsSpec: ParsedNomadLinkFieldsSpec,
): Record<string, string> {
  const requestData: Record<string, string> = {};
  mergeNomadRequestVars(requestData, fieldsSpec.requestVars);

  const allFields = fieldsSpec.fieldNames === '*';
  const namedFields = fieldsSpec.fieldNames === '*' ? null : new Set(fieldsSpec.fieldNames);

  const inputs = container.querySelectorAll<HTMLInputElement>('input[name]');
  for (const input of inputs) {
    const name = input.name;
    if (!name) continue;
    if (!allFields && namedFields && !namedFields.has(name)) continue;

    const fieldKey = `field_${name}`;

    if (input.type === 'checkbox') {
      if (!input.checked) continue;
      const value = input.value || '1';
      const existing = requestData[fieldKey];
      requestData[fieldKey] = existing ? `${existing},${value}` : value;
      continue;
    }

    if (input.type === 'radio') {
      if (!input.checked) continue;
      requestData[fieldKey] = input.value;
      continue;
    }

    requestData[fieldKey] = input.value;
  }

  return requestData;
}

/** Build request payload for a Micron link activation (path + optional form data). */
export function buildNomadLinkRequest(
  destination: string,
  dataFieldsAttr: string | null | undefined,
  container: HTMLElement | null,
): { destination: string; requestData: Record<string, string> } {
  const { baseDestination, embeddedFieldsSpec } = splitNomadLinkDestination(destination);
  const attrSpec = dataFieldsAttr?.trim() ? parseNomadLinkFieldsSpec(dataFieldsAttr) : null;
  const embeddedSpec = embeddedFieldsSpec
    ? parseNomadLinkFieldsSpec(embeddedFieldsSpec)
    : { fieldNames: [] as string[], requestVars: {} };

  const mergedSpec: ParsedNomadLinkFieldsSpec = {
    fieldNames:
      attrSpec?.fieldNames === '*' || embeddedSpec.fieldNames === '*'
        ? '*'
        : [...(attrSpec?.fieldNames ?? []), ...embeddedSpec.fieldNames],
    requestVars: { ...embeddedSpec.requestVars, ...attrSpec?.requestVars },
  };

  const requestData =
    container &&
    (mergedSpec.fieldNames === '*' ||
      mergedSpec.fieldNames.length > 0 ||
      Object.keys(mergedSpec.requestVars).length > 0)
      ? collectNomadFormFieldValues(container, mergedSpec)
      : {
          ...Object.fromEntries(
            Object.entries(mergedSpec.requestVars).map(([k, v]) => [`var_${k}`, v]),
          ),
        };

  return { destination: baseDestination, requestData };
}

/** Normalize empty/undefined request maps to undefined for identity comparisons. */
export function normalizeNomadPageRequestData(
  data?: NomadPageRequestData | null,
): NomadPageRequestData | undefined {
  if (!data) return undefined;
  const entries = Object.entries(data).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

/**
 * Stable cache/history key fragment for Nomad page request data.
 * Empty or undefined data → `""`.
 */
export function serializeNomadPageRequestDataKey(data?: NomadPageRequestData | null): string {
  const normalized = normalizeNomadPageRequestData(data);
  if (!normalized) return '';
  return Object.keys(normalized)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(normalized[key] ?? '')}`)
    .join('|');
}

/**
 * Micron-style backtick URL suffix from `var_*` request keys (strip `var_` prefix).
 * Form-only `field_*` keys are omitted (not URL-bar round-trippable as static link vars).
 * Returns `""` when there are no displayable vars (caller should not append a backtick).
 */
export function formatNomadRequestDataForUrlBar(data?: NomadPageRequestData | null): string {
  const normalized = normalizeNomadPageRequestData(data);
  if (!normalized) return '';
  const parts: string[] = [];
  for (const key of Object.keys(normalized).sort((a, b) => a.localeCompare(b))) {
    if (!key.startsWith('var_')) continue;
    const name = key.slice('var_'.length);
    if (!name) continue;
    parts.push(`${name}=${normalized[key]}`);
  }
  return parts.join('|');
}

/** Compare two request-data maps by stable serialized key. */
export function nomadPageRequestDataEquals(
  a?: NomadPageRequestData | null,
  b?: NomadPageRequestData | null,
): boolean {
  return serializeNomadPageRequestDataKey(a) === serializeNomadPageRequestDataKey(b);
}
