/**
 * Read a value for React dependency / subscription purposes without using `void`.
 * Prefer this over `void x` — typescript-eslint 8.69+ flags void on non-call expressions.
 */
export function touch(value: unknown): void {
  // Reference the value so the parameter is "used" without a void expression.
  if (value === undefined) {
    return;
  }
}
