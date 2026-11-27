/** `url` shim for the mobile host worker (WHATWG URL plus the Node file-URL helpers). */
export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;

export function fileURLToPath(u: string | URL): string {
  const url = typeof u === 'string' ? new globalThis.URL(u) : u;
  if (url.protocol !== 'file:') throw new TypeError('The URL must be of scheme file');
  return decodeURIComponent(url.pathname);
}

export function pathToFileURL(p: string): URL {
  return new globalThis.URL(`file://${encodeURI(p.startsWith('/') ? p : `/${p}`)}`);
}

export interface LegacyUrl {
  protocol: string | null;
  slashes: boolean | null;
  auth: string | null;
  host: string | null;
  port: string | null;
  hostname: string | null;
  hash: string | null;
  search: string | null;
  query: string | Record<string, string> | null;
  pathname: string | null;
  path: string | null;
  href: string;
}

/** Legacy `url.parse` (used by mqtt.js for broker URLs). */
export function parse(s: string, parseQuery = false): LegacyUrl {
  let u: globalThis.URL | null = null;
  try {
    u = new globalThis.URL(s);
  } catch {
    // catch-no-log-ok relative or invalid URL → treat as a path
  }
  if (!u) {
    const [pathname, search = ''] = s.split('?');
    return {
      protocol: null,
      slashes: null,
      auth: null,
      host: null,
      port: null,
      hostname: null,
      hash: null,
      search: search ? `?${search}` : null,
      query: parseQuery
        ? Object.fromEntries(new globalThis.URLSearchParams(search))
        : search || null,
      pathname,
      path: s,
      href: s,
    };
  }
  const auth = u.username
    ? `${decodeURIComponent(u.username)}${u.password ? `:${decodeURIComponent(u.password)}` : ''}`
    : null;
  return {
    protocol: u.protocol,
    slashes: true,
    auth,
    host: u.host || null,
    port: u.port || null,
    hostname: u.hostname.replace(/^\[|\]$/g, '') || null,
    hash: u.hash || null,
    search: u.search || null,
    query: parseQuery ? Object.fromEntries(u.searchParams) : u.search.slice(1) || null,
    pathname: u.pathname || null,
    path: `${u.pathname}${u.search}` || null,
    href: u.href,
  };
}

export function format(u: string | URL | Partial<LegacyUrl>): string {
  if (typeof u === 'string') return u;
  if (u instanceof globalThis.URL) return u.href;
  const auth = u.auth ? `${u.auth}@` : '';
  const host = u.host ?? `${u.hostname ?? ''}${u.port ? `:${u.port}` : ''}`;
  return `${u.protocol ?? ''}${u.slashes || u.protocol ? '//' : ''}${auth}${host}${u.pathname ?? ''}${u.search ?? ''}${u.hash ?? ''}`;
}

export function resolve(from: string, to: string): string {
  return new globalThis.URL(to, new globalThis.URL(from, 'resolve://')).href.replace(
    /^resolve:\/\//,
    '',
  );
}

export function domainToASCII(d: string): string {
  try {
    return new globalThis.URL(`http://${d}`).hostname;
  } catch {
    return ''; // catch-no-log-ok invalid domain
  }
}

export default {
  URL,
  URLSearchParams,
  fileURLToPath,
  pathToFileURL,
  parse,
  format,
  resolve,
  domainToASCII,
};
