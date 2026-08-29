/**
 * Client-side validation for new Micron page names.
 *
 * The sidecar path-jails every write (`resolve_under_root` plus symlink rejection),
 * so this is a UX guard only: it keeps obviously bad names from making a round trip.
 */

/** Reject empty names, traversal, absolute paths, and anything not ending in `.mu`. */
export function isValidMicronPageName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (!trimmed.toLowerCase().endsWith('.mu')) return false;
  // Leave room for a `page/foo.mu` subdirectory, but nothing that climbs out.
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return false;
  if (trimmed.includes('..')) return false;
  if (trimmed.includes('\\')) return false;
  if (trimmed.split('/').some((segment) => segment.trim().length === 0)) return false;
  // Control characters are rejected upstream; catch them before the round trip.
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}
