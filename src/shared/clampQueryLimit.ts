/**
 * Clamp an IPC/query `limit` to `[min, max]`, falling back when the value is
 * missing or non-numeric (`Number(value) || default` — same as the prior
 * copy-pasted handlers).
 */
export function clampQueryLimit(
  value: unknown,
  opts: { default: number; min?: number; max: number },
): number {
  const min = opts.min ?? 1;
  return Math.min(Math.max(min, Number(value) || opts.default), opts.max);
}
