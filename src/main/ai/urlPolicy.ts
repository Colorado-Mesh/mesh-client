import { Address4, Address6 } from 'ip-address';

export type EndpointClass = 'local' | 'remote';

/** Host with brackets removed. Null when `host` is not an IP literal. */
export function literalAddressIsGlobal(host: string): boolean | null {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (Address4.isValid(bare)) return new Address4(bare).isGlobal();
  if (Address6.isValid(bare)) {
    const ip = new Address6(bare);
    // IPv4-mapped addresses use the IPv4 global predicate.
    if (ip.is4()) return ip.to4().isGlobal();
    return ip.isGlobal();
  }
  return null;
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
  } catch {
    // catch-no-log-ok invalid user input is reported without disclosing endpoints
    return { ok: false, reason: 'invalid' };
  }
}
export function validateAiEndpointUrl(raw: string, allowRemote: boolean) {
  const result = classifyEndpoint(raw);
  if (result.ok && result.cls === 'remote' && !allowRemote)
    return { ok: false as const, reason: 'remoteNotAcknowledged' };
  return result;
}
