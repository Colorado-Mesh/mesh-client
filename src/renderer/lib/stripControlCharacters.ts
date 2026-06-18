/** Remove ASCII control characters (0x00–0x1F, 0x7F) for safe OS notification text. */
export function stripControlCharacters(text: string): string {
  return text.replace(/[\x00-\x1F\x7F]/g, ''); // eslint-disable-line no-control-regex
}
