/** DNS label: 1–63 chars, alphanumeric + hyphens, no leading/trailing hyphen (RFC 1123). */
function isValidDnsLabel(label: string): boolean {
  if (label.length === 0 || label.length > 63) return false;
  if (label.startsWith('-') || label.endsWith('-')) return false;
  return /^[a-zA-Z0-9-]+$/.test(label);
}

/**
 * Hostname validation for HTTP/TCP connect: dotted DNS labels (incl. IPv4 quads).
 * Empty string and length > 253 are handled by callers.
 */
export function isValidHttpHostname(host: string): boolean {
  if (host.length === 0) return false;
  const labels = host.split('.');
  if (labels.some((label) => label.length === 0)) return false;
  return labels.every(isValidDnsLabel);
}
