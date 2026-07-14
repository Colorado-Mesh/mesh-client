/** Normalize LXMF / Reticulum message hash for case-insensitive equality. */
export function normalizeReticulumMessageHash(hash: string | null | undefined): string {
  return (hash ?? '').trim().toLowerCase();
}

export function reticulumMessageHashesEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizeReticulumMessageHash(a);
  const right = normalizeReticulumMessageHash(b);
  return left.length > 0 && left === right;
}
