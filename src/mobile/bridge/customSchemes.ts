/**
 * Images on custom schemes the Electron main process serves (`mesh-tiles:` map tiles,
 * `mesh-weather:` radar). A WebView cannot load those URLs, so on mobile an `<img>` whose `src`
 * is set to one is resolved through the host (`__mobile:protocolFetch`, the same protocol handler
 * main registered) and shown as a blob URL. Covers Leaflet tiles (`img.src = …`) and React
 * `<img src>` (`setAttribute`). Blob URLs are cached (LRU) and revoked on eviction.
 */
import { hostInvoke } from './hostClient';

const SCHEME_RE = /^mesh-(tiles|weather):\/\//;
const CACHE_LIMIT = 400;
const cache = new Map<string, Promise<string>>();
const requested = new WeakMap<HTMLImageElement, string>();

interface FetchResult {
  status: number;
  contentType: string;
  bytes: Uint8Array;
}

function evict(): void {
  while (cache.size > CACHE_LIMIT) {
    const [oldest, p] = cache.entries().next().value!;
    cache.delete(oldest);
    void p.then(
      (u) => {
        URL.revokeObjectURL(u);
      },
      () => {},
    );
  }
}

function resolveSchemeUrl(url: string): Promise<string> {
  const hit = cache.get(url);
  if (hit) {
    cache.delete(url);
    cache.set(url, hit);
    return hit;
  }
  const p = (hostInvoke('__mobile:protocolFetch', [url]) as Promise<FetchResult>).then((r) => {
    if (r.status < 200 || r.status >= 300 || r.bytes.byteLength === 0) {
      throw new Error(`tile ${r.status}`);
    }
    return URL.createObjectURL(
      new Blob([r.bytes as BlobPart], { type: r.contentType || 'image/png' }),
    );
  });
  p.catch(() => cache.delete(url));
  cache.set(url, p);
  evict();
  return p;
}

function load(img: HTMLImageElement, url: string, setReal: (v: string) => void): void {
  requested.set(img, url);
  resolveSchemeUrl(url).then(
    (blobUrl) => {
      if (requested.get(img) === url) setReal(blobUrl);
    },
    () => {
      if (requested.get(img) === url) img.dispatchEvent(new Event('error'));
    },
  );
}

export function installCustomSchemeImages(): void {
  const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (!desc?.set || !desc.get) return;
  const nativeSet = desc.set;
  const nativeGet = desc.get;
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    enumerable: desc.enumerable,
    get(this: HTMLImageElement) {
      return requested.get(this) ?? (nativeGet.call(this) as string);
    },
    set(this: HTMLImageElement, value: string) {
      if (typeof value === 'string' && SCHEME_RE.test(value)) {
        load(this, value, (v) => {
          nativeSet.call(this, v);
        });
        return;
      }
      requested.delete(this);
      nativeSet.call(this, value);
    },
  });
  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
    if (this instanceof HTMLImageElement && name.toLowerCase() === 'src' && SCHEME_RE.test(value)) {
      load(this, value, (v) => {
        nativeSetAttribute.call(this, 'src', v);
      });
      return;
    }
    if (this instanceof HTMLImageElement && name.toLowerCase() === 'src') requested.delete(this);
    nativeSetAttribute.call(this, name, value);
  };
}
