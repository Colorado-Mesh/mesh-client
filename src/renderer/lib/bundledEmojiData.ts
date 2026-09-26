/**
 * Offline emoji data for the Linux `<emoji-picker>` (emoji-picker-element).
 *
 * The picker fetches its data from cdn.jsdelivr.net on first use, so an offline Linux laptop (a
 * field responder with no internet) got an empty picker. We vendor the English data
 * (`assets/emoji/emojibase-en.json`, emoji-picker-element-data 1.8.0) and point the picker at a
 * sentinel URL that `installBundledEmojiData()` answers from that file. Nothing touches the
 * network; every other request passes straight through. The JSON is a lazy chunk, loaded the
 * first time the picker opens.
 */

/** `data-source` for every `<emoji-picker>`; never resolved over the network. */
export const BUNDLED_EMOJI_DATA_SOURCE = 'https://emoji-data.mesh-client.invalid/en/data.json';

/** Changes when the vendored file changes, so the picker's IndexedDB cache refreshes. */
export const BUNDLED_EMOJI_DATA_ETAG = 'W/"emoji-picker-element-data@1.8.0-en"';

let installed = false;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  return method.toUpperCase();
}

async function loadBundledEmojiJson(): Promise<string> {
  const mod = await import('../assets/emoji/emojibase-en.json?raw');
  return mod.default;
}

/** Response for the sentinel URL: GET gets the data, HEAD only the ETag (the picker's update check). */
export async function bundledEmojiDataResponse(method: string): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', ETag: BUNDLED_EMOJI_DATA_ETAG };
  if (method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(await loadBundledEmojiJson(), { status: 200, headers });
}

/** Wrap `window.fetch` once so the sentinel URL is served locally. Call from the renderer entry. */
export function installBundledEmojiData(target: Pick<Window, 'fetch'> = window): void {
  if (installed) return;
  installed = true;
  const originalFetch = target.fetch.bind(target);
  target.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (requestUrl(input) !== BUNDLED_EMOJI_DATA_SOURCE) return originalFetch(input, init);
    return bundledEmojiDataResponse(requestMethod(input, init));
  };
}

/** Test hook. */
export function resetBundledEmojiDataForTests(): void {
  installed = false;
}
