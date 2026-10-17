import { Address4, Address6 } from 'ip-address';

export type EndpointClass = 'local' | 'remote';
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
    let local = host === 'localhost' || host.endsWith('.local');
    if (Address4.isValid(host)) {
      const ip = new Address4(host);
      local = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].some((range) =>
        ip.isInSubnet(new Address4(range)),
      );
    } else if (Address6.isValid(host)) {
      const ip = new Address6(host);
      // IPv4-mapped addresses must satisfy the IPv4 policy too.
      local = ip.isInSubnet(new Address6('::ffff:0:0/96'))
        ? classifyEndpoint(`http://${ip.to4().address}`).ok
        : ['::1/128', 'fc00::/7', 'fe80::/10'].some((range) => ip.isInSubnet(new Address6(range)));
    }
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
