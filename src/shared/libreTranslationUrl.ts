import { isLoopbackHost, isValidConnectHost, stripConnectHostBrackets } from './connectHost';

/** Only canonical localhost and literal loopback addresses may use cleartext HTTP. */
function isCleartextLibreTranslationHostAllowed(hostname: string): boolean {
  const host = stripConnectHostBrackets(hostname).toLowerCase();
  return host === 'localhost' || isLoopbackHost(host);
}

export function validateLibreTranslationUrl(value: string): string {
  if (value.length > 2_048) throw new Error('Invalid LibreTranslate URL');
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !isValidConnectHost(url.hostname) ||
    (url.protocol === 'http:' && !isCleartextLibreTranslationHostAllowed(url.hostname))
  ) {
    throw new Error('Invalid LibreTranslate URL');
  }
  return url.href.replace(/\/$/, '');
}
