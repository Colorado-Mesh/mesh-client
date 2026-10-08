import { isValidConnectHost } from './connectHost';

export function validateLibreTranslationUrl(value: string): string {
  if (value.length > 2_048) throw new Error('Invalid LibreTranslate URL');
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !isValidConnectHost(url.hostname)
  ) {
    throw new Error('Invalid LibreTranslate URL');
  }
  return url.href.replace(/\/$/, '');
}
