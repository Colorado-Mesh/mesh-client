import { isGlobalIpLiteral } from '../../shared/ipLiteral';
import { sanitizeLogMessage } from '../sanitize-log-message';

export type EndpointClass = 'local' | 'remote';

/** Host with brackets removed. Null when `host` is not an IP literal. */
export function literalAddressIsGlobal(host: string): boolean | null {
  return isGlobalIpLiteral(host);
}

export function classifyEndpoint(
  raw: string,
): { ok: true; cls: EndpointClass; url: string } | { ok: false; reason: 'invalid' | 'insecure' } {
  try {
    const url = new URL(raw);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return { ok: false, reason: 'invalid' };
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const globalLiteral = literalAddressIsGlobal(host);
    // Non-global literals (loopback, RFC1918, link-local, CGNAT, unspecified) are local.
    const local =
      globalLiteral == null ? host === 'localhost' || host.endsWith('.local') : !globalLiteral;
    if (!local && url.protocol !== 'https:') return { ok: false, reason: 'insecure' };
    return { ok: true, cls: local ? 'local' : 'remote', url: url.href.replace(/\/+$/, '') };
  } catch (e: unknown) {
    console.debug(
      '[main/ai/urlPolicy] catch:',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );

    return { ok: false, reason: 'invalid' };
  }
}
export function validateAiEndpointUrl(raw: string, allowRemote: boolean) {
  const result = classifyEndpoint(raw);
  if (result.ok && result.cls === 'remote' && !allowRemote)
    return { ok: false as const, reason: 'remoteNotAcknowledged' };
  return result;
}
