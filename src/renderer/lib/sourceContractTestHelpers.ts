/** Returns the inner text of a `{ ... }` block starting at `openBraceIndex`. */
export function extractBalancedBlock(source: string, openBraceIndex: number): string {
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(openBraceIndex + 1, i);
    }
  }
  throw new Error(`Unbalanced braces at index ${openBraceIndex}`);
}

export function extractIfBlockBody(source: string, condition: string): string {
  const marker = `if (${condition})`;
  const ifIndex = source.indexOf(marker);
  if (ifIndex === -1) return '';
  const braceIndex = source.indexOf('{', ifIndex);
  if (braceIndex === -1) return '';
  return extractBalancedBlock(source, braceIndex);
}

export function extractUseCallbackBody(source: string, name: string): string {
  const marker = `const ${name} = useCallback(`;
  const start = source.indexOf(marker);
  if (start === -1) return '';
  const arrowIndex = source.indexOf('=> {', start);
  if (arrowIndex === -1) return '';
  const braceIndex = source.indexOf('{', arrowIndex);
  if (braceIndex === -1) return '';
  return extractBalancedBlock(source, braceIndex);
}
