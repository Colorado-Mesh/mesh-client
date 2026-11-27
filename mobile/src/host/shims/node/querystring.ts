/** `querystring` shim. */
export function parse(s: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(s));
}
export function stringify(o: Record<string, unknown>): string {
  return new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();
}
export const escape = encodeURIComponent;
export const unescape = decodeURIComponent;
export default { parse, stringify, escape, unescape };
