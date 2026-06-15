/** Reject path traversal and path separators in XMODEM remote filenames. */
export function isValidXmodemRemoteFilename(filename: string): boolean {
  const trimmed = filename.trim();
  if (!trimmed) return false;
  if (trimmed.includes('\0')) return false;
  if (trimmed.includes('..')) return false;
  if (/[/\\]/.test(trimmed)) return false;
  return true;
}
