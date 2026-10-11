import type { NomadPageRequestData } from '@/shared/nomad-types';

import MicronParser, {
  MICRON_RENDER_LIMITS,
  type MicronPartialCleanup,
  type MicronPartialFetchResult,
  type MicronPartialInfo,
} from './vendor/micron-parser.js';

export type { MicronPartialCleanup, MicronPartialFetchResult, MicronPartialInfo };
export { MICRON_RENDER_LIMITS, MicronParser };

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

export interface NomadMicronPartialFetchResultWithSize {
  /** Raw remote Micron source. The controller renders it only after budget admission. */
  source: string;
  /** UTF-8 bytes in the remote Micron source before rendering. */
  sourceBytes: number;
}

export const NOMAD_MICRON_PARTIAL_LIMITS = Object.freeze({
  maxDepth: 8,
  maxPartials: 64,
  maxSourceBytes: 1024 * 1024,
  maxConcurrency: 1,
  maxRefreshTimers: 8,
  maxRequests: 128,
  maxRequestsPerMinute: 60,
  maxLifetimeMs: 5 * 60 * 1000,
});

/**
 * Resolve a Micron partial destination and fetch/render its content.
 * Failure point: sidecar/page fetch fails or destination is invalid.
 * Fallback: throw so the page-scoped partial controller records an error on the placeholder.
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
}): Promise<NomadMicronPartialFetchResultWithSize> {
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

  return {
    source: res.content,
    sourceBytes: new TextEncoder().encode(res.content).byteLength,
  };
}

type NomadMicronBoundPartialResult =
  MicronPartialFetchResult | NomadMicronPartialFetchResultWithSize;

interface NomadMicronPartialBinding {
  element: HTMLElement;
  depth: number;
  ancestry: readonly string[];
  resourceKey: string | null;
  controller: AbortController | null;
  interval: ReturnType<typeof setInterval> | null;
  loading: boolean;
  queued: boolean;
  disposed: boolean;
}

export function canonicalNomadPageResourceKey(hash: string, path: string): string {
  const segments: string[] = [];
  for (const segment of normalizeNomadPagePath(path).split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `${hash.trim().toLowerCase()}:/${segments.join('/')}`;
}

export function resolveNomadPartialResourceKey(
  destination: string,
  selectedHash: string,
  defaultPagePath: string,
): string | null {
  let parsed = parseNomadNetworkLinkUrl(destination, defaultPagePath);
  if (!parsed && destination.trim().startsWith('/')) {
    parsed = {
      destination_hash: null,
      path: normalizeNomadPagePath(destination),
    };
  }
  if (!parsed) return null;
  return canonicalNomadPageResourceKey(parsed.destination_hash ?? selectedHash, parsed.path);
}

/**
 * Bind every partial in one page-scoped controller. The controller owns recursive
 * discovery, refreshes, requests, and cleanup so a remote page cannot create an
 * independent resource pool for each nested partial.
 */
export function bindNomadMicronPartials(
  root: HTMLElement,
  fetcher: (info: MicronPartialInfo) => Promise<NomadMicronBoundPartialResult>,
  options: {
    rootResourceKey?: string | null;
    resolveResourceKey?: (info: MicronPartialInfo) => string | null;
    /** Display a safe notice when content or refresh work is incomplete. */
    onPaused?: () => void;
  } = {},
): MicronPartialCleanup {
  const limits = NOMAD_MICRON_PARTIAL_LIMITS;
  const bindings = new Map<HTMLElement, NomadMicronPartialBinding>();
  const queue: NomadMicronPartialBinding[] = [];
  const requestTimes: number[] = [];
  const initialAncestry = options.rootResourceKey ? [options.rootResourceKey] : [];
  let admittedPartials = 0;
  let sourceBytes = 0;
  let totalRequests = 0;
  let activeRequests = 0;
  let refreshTimers = 0;
  let stopped = false;

  const readPartial = (element: HTMLElement): Omit<MicronPartialInfo, 'signal'> => {
    const url = element.getAttribute('data-partial-url');
    const destination = element.getAttribute('data-partial-destination') || url || '';
    const descriptor = element.getAttribute('data-partial-descriptor') || '';
    const refresh = Number.parseFloat(element.getAttribute('data-partial-refresh') || '0');
    const fieldsAttr = element.getAttribute('data-partial-fields') || '';
    const fields = fieldsAttr.length > 0 ? fieldsAttr.split('|') : [];
    const id = element.getAttribute('data-partial-id');
    return { url, destination, descriptor, refresh, fields, id, element };
  };

  const setError = (binding: NomadMicronPartialBinding, error: unknown) => {
    if (binding.disposed) return;
    const message = error instanceof Error ? error.message : String(error);
    binding.element.setAttribute('data-partial-error', message);
    options.onPaused?.();
    binding.element.dispatchEvent(
      new CustomEvent('partial-error', {
        bubbles: true,
        detail: { error, info: readPartial(binding.element) },
      }),
    );
  };

  const disposeBinding = (binding: NomadMicronPartialBinding) => {
    if (binding.disposed) return;
    binding.disposed = true;
    binding.queued = false;
    binding.controller?.abort();
    binding.controller = null;
    if (binding.interval != null) {
      clearInterval(binding.interval);
      binding.interval = null;
      refreshTimers = Math.max(0, refreshTimers - 1);
    }
    binding.element.removeAttribute('data-partial-bound');
    bindings.delete(binding.element);
  };

  const disposeDescendants = (element: HTMLElement) => {
    for (const binding of Array.from(bindings.values())) {
      if (binding.element !== element && element.contains(binding.element)) {
        disposeBinding(binding);
      }
    }
  };

  const stop = (notify = false) => {
    if (stopped) return;
    if (notify) options.onPaused?.();
    stopped = true;
    queue.splice(0);
    for (const binding of Array.from(bindings.values())) {
      disposeBinding(binding);
    }
  };

  const lifetimeTimer = setTimeout(() => {
    const incomplete = Array.from(bindings.values()).some(
      (binding) => binding.interval != null || binding.loading || binding.queued,
    );
    stop(incomplete);
  }, limits.maxLifetimeMs);

  const resultSourceBytes = (result: NomadMicronBoundPartialResult): number => {
    if (
      result &&
      typeof result === 'object' &&
      'sourceBytes' in result &&
      typeof result.sourceBytes === 'number'
    ) {
      return Math.max(0, Math.floor(result.sourceBytes));
    }
    if (typeof result === 'string') return new TextEncoder().encode(result).byteLength;
    if (result && typeof result === 'object' && 'markup' in result) {
      return new TextEncoder().encode(result.markup).byteLength;
    }
    if (typeof Node !== 'undefined' && result instanceof Node) {
      return new TextEncoder().encode(result.textContent ?? '').byteLength;
    }
    return 0;
  };

  const prepareResult = (result: NomadMicronBoundPartialResult): Node[] | null => {
    if (result == null) return null;
    if (typeof Node !== 'undefined' && result instanceof Node) return [result];
    let markup: string;
    if (typeof result === 'string') {
      markup = result;
    } else if ('source' in result && typeof result.source === 'string') {
      markup = renderNomadMicronPage(result.source);
    } else if ('markup' in result && typeof result.markup === 'string') {
      markup = result.markup;
    } else {
      return [];
    }
    const staging = document.createElement('div');
    mountNomadMicronHtml(staging, markup);
    return Array.from(staging.childNodes);
  };

  const commitResult = (
    element: HTMLElement,
    result: NomadMicronBoundPartialResult,
    nodes: readonly Node[],
  ) => {
    element.replaceChildren(...nodes);
    element.removeAttribute('data-partial-error');
    element.setAttribute('data-partial-loaded', String(Date.now()));
    element.dispatchEvent(new CustomEvent('partial-loaded', { bubbles: true, detail: { result } }));
  };

  let bindScope: (scope: ParentNode, depth: number, ancestry: readonly string[]) => void = () => {};
  const controllerStopped = () => stopped;
  const bindingDisposed = (binding: NomadMicronPartialBinding) => binding.disposed;

  const runBinding = async (binding: NomadMicronPartialBinding) => {
    binding.queued = false;
    if (stopped || binding.disposed || !root.contains(binding.element)) {
      disposeBinding(binding);
      return;
    }

    const now = Date.now();
    while (requestTimes.length > 0 && now - (requestTimes[0] ?? now) >= 60_000) {
      requestTimes.shift();
    }
    if (totalRequests >= limits.maxRequests) {
      setError(binding, new Error('partial_request_limit'));
      stop();
      return;
    }
    if (requestTimes.length >= limits.maxRequestsPerMinute) {
      setError(binding, new Error('partial_request_rate_limit'));
      stop();
      return;
    }

    totalRequests += 1;
    requestTimes.push(now);
    const info = readPartial(binding.element);
    if (!info.url) return;
    const controller = new AbortController();
    binding.controller = controller;
    binding.loading = true;
    binding.element.dispatchEvent(
      new CustomEvent('partial-loading', { bubbles: true, detail: info }),
    );
    try {
      const result = await fetcher({ ...info, signal: controller.signal });
      if (
        controllerStopped() ||
        bindingDisposed(binding) ||
        controller.signal.aborted ||
        !root.contains(binding.element)
      ) {
        return;
      }
      const nextBytes = resultSourceBytes(result);
      if (sourceBytes + nextBytes > limits.maxSourceBytes) {
        setError(binding, new Error('partial_source_byte_limit'));
        stop();
        return;
      }
      sourceBytes += nextBytes;
      const nodes = prepareResult(result);
      if (nodes == null) return;
      binding.element.dispatchEvent(
        new CustomEvent('partial-replacing', { bubbles: true, detail: info }),
      );
      disposeDescendants(binding.element);
      commitResult(binding.element, result, nodes);
      const ancestry = binding.resourceKey
        ? [...binding.ancestry, binding.resourceKey]
        : binding.ancestry;
      bindScope(binding.element, binding.depth + 1, ancestry);
    } catch (error) {
      // catch-no-log-ok Controller aborts are expected during refresh and page teardown.
      if (!controller.signal.aborted && !bindingDisposed(binding) && !controllerStopped()) {
        setError(binding, error);
      }
    } finally {
      if (binding.controller === controller) binding.controller = null;
      binding.loading = false;
    }
  };

  const drain = () => {
    if (stopped) return;
    while (activeRequests < limits.maxConcurrency && queue.length > 0) {
      const binding = queue.shift();
      if (!binding || binding.disposed || !binding.queued || binding.loading) continue;
      activeRequests += 1;
      void runBinding(binding).finally(() => {
        activeRequests = Math.max(0, activeRequests - 1);
        drain();
      });
    }
  };

  const enqueue = (binding: NomadMicronPartialBinding) => {
    if (stopped || binding.disposed || binding.loading || binding.queued) return;
    binding.queued = true;
    queue.push(binding);
    drain();
  };

  bindScope = (scope, depth, ancestry) => {
    if (stopped) return;
    const elements = Array.from(
      scope.querySelectorAll<HTMLElement>('.Mu-partial:not([data-partial-bound])'),
    );
    for (const element of elements) {
      if (depth > limits.maxDepth) {
        element.setAttribute('data-partial-error', 'partial_depth_limit');
        options.onPaused?.();
        continue;
      }
      admittedPartials += 1;
      if (admittedPartials > limits.maxPartials) {
        element.setAttribute('data-partial-error', 'partial_count_limit');
        stop(true);
        return;
      }
      const info = readPartial(element);
      const resourceKey = options.resolveResourceKey?.({ ...info, signal: null }) ?? null;
      const binding: NomadMicronPartialBinding = {
        element,
        depth,
        ancestry,
        resourceKey,
        controller: null,
        interval: null,
        loading: false,
        queued: false,
        disposed: false,
      };
      bindings.set(element, binding);
      element.setAttribute('data-partial-bound', '1');

      if (resourceKey && ancestry.includes(resourceKey)) {
        setError(binding, new Error('partial_cycle'));
        continue;
      }

      enqueue(binding);
      if (Number.isFinite(info.refresh) && info.refresh >= 1) {
        if (refreshTimers >= limits.maxRefreshTimers) {
          element.setAttribute('data-partial-refresh-error', 'partial_timer_limit');
          options.onPaused?.();
        } else {
          refreshTimers += 1;
          binding.interval = setInterval(() => {
            enqueue(binding);
          }, info.refresh * 1000);
        }
      }
    }
  };

  bindScope(root, 1, initialAncestry);

  const cleanup: MicronPartialCleanup = () => {
    clearTimeout(lifetimeTimer);
    stop();
  };
  cleanup.reload = (predicate) => {
    for (const binding of bindings.values()) {
      const info = readPartial(binding.element);
      if (!predicate || predicate({ ...info, signal: binding.controller?.signal ?? null })) {
        enqueue(binding);
      }
    }
  };
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

/** True when a Nomad link path targets the `/media` WebP host (NomadNet 1.4.1). */
export function isNomadMediaPath(path: string): boolean {
  const normalized = normalizeNomadPagePath(path);
  return normalized === '/media' || normalized.startsWith('/media/');
}

/**
 * Resolve a Micron image URL into node hash + `/media/...` request path.
 * Matches NomadNet Browser.__get_image_request_data (path from parse_url).
 */
export function resolveNomadMediaFetchTarget(
  mediaUrl: string,
  selectedHash: string,
  defaultPagePath: string = DEFAULT_NOMAD_NODE_PAGE_PATH,
): { hash: string; mediaPath: string } | null {
  const trimmed = stripNomadUrlSchemes(mediaUrl.trim());
  if (!trimmed) return null;

  let parsed = parseNomadNetworkLinkUrl(trimmed, defaultPagePath);
  if (!parsed && (trimmed.startsWith('/media/') || trimmed === '/media')) {
    parsed = { destination_hash: null, path: normalizeNomadPagePath(trimmed) };
  }
  if (!parsed || !isNomadMediaPath(parsed.path)) return null;

  return {
    hash: parsed.destination_hash ?? selectedHash,
    mediaPath: parsed.path,
  };
}

export interface NomadMicronMediaFetchResult {
  ok: boolean;
  content_base64?: string;
  file_name?: string;
  error?: string;
}

/** Max in-flight Nomad `/media` fetches per bind (serialize like NomadNet Link use). */
export const NOMAD_MICRON_MEDIA_FETCH_CONCURRENCY = 1;

async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const n = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        if (item === undefined) continue;
        await worker(item);
      }
    }),
  );
}

/**
 * After Micron mount, fetch WebP bytes for each `[data-nomad-media-url]` placeholder.
 * Does not use `/file` downloads — callers must use the Nomad `/media` API.
 */
export async function bindNomadMicronMedia(
  root: HTMLElement,
  opts: {
    selectedHash: string;
    defaultPagePath?: string;
    fetchMedia: (hash: string, mediaPath: string) => Promise<NomadMicronMediaFetchResult>;
    /** Force image/webp data URLs (NomadNet media is always WebP). */
    toDataUrl?: (fileName: string, contentBase64: string) => string | null;
    signal?: AbortSignal;
    /** Override default {@link NOMAD_MICRON_MEDIA_FETCH_CONCURRENCY} (tests). */
    concurrency?: number;
  },
): Promise<void> {
  const defaultPagePath = opts.defaultPagePath ?? DEFAULT_NOMAD_NODE_PAGE_PATH;
  const toDataUrl = opts.toDataUrl;
  const signal = opts.signal;
  const concurrency = opts.concurrency ?? NOMAD_MICRON_MEDIA_FETCH_CONCURRENCY;
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('[data-nomad-media-url]'));

  const setNotice = (notice: Element | null | undefined, text: string) => {
    if (signal?.aborted || !notice) return;
    notice.textContent = text;
  };

  await runPool(images, concurrency, async (img) => {
    if (signal?.aborted) return;
    const url = img.getAttribute('data-nomad-media-url') ?? '';
    const alt = img.getAttribute('data-nomad-media-alt') ?? img.alt;
    const notice = img.parentElement?.querySelector('.nomad-micron-media-notice');
    const target = resolveNomadMediaFetchTarget(url, opts.selectedHash, defaultPagePath);
    if (!target) {
      setNotice(notice, alt ? `[${alt}]` : '[invalid media url]');
      return;
    }
    setNotice(notice, alt ? `Loading ${alt}…` : 'Loading image…');
    try {
      const res = await opts.fetchMedia(target.hash, target.mediaPath);
      if (signal?.aborted) return;
      if (!res.ok || !res.content_base64) {
        setNotice(
          notice,
          alt
            ? `Could not load ${alt}`
            : `Could not load image${res.error ? `: ${res.error}` : ''}`,
        );
        return;
      }
      const fileName =
        res.file_name && /\.webp$/i.test(res.file_name)
          ? res.file_name
          : `${(target.mediaPath.split('/').pop() || 'image').replace(/\.[^.]+$/, '') || 'image'}.webp`;
      const dataUrl = toDataUrl
        ? toDataUrl(fileName, res.content_base64)
        : `data:image/webp;base64,${res.content_base64}`;
      if (signal?.aborted) return;
      if (!dataUrl) {
        setNotice(notice, alt ? `Could not display ${alt}` : 'Could not display image');
        return;
      }
      img.src = dataUrl;
      setNotice(notice, '');
      if (!signal?.aborted) notice?.setAttribute('hidden', 'true');
    } catch (e) {
      if (signal?.aborted) return;
      console.warn('[bindNomadMicronMedia] fetch failed', e);
      setNotice(
        notice,
        alt
          ? `Could not load ${alt}`
          : `Could not load image: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });
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
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
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
