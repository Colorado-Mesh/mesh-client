/** `timers` / `timers/promises` shim. */
export const setTimeout = (...a: Parameters<typeof globalThis.setTimeout>) =>
  globalThis.setTimeout(...a);
export const clearTimeout = (h: Parameters<typeof globalThis.clearTimeout>[0]) => {
  globalThis.clearTimeout(h);
};
export const setInterval = (...a: Parameters<typeof globalThis.setInterval>) =>
  globalThis.setInterval(...a);
export const clearInterval = (h: Parameters<typeof globalThis.clearInterval>[0]) => {
  globalThis.clearInterval(h);
};
export const setImmediate = (fn: (...a: unknown[]) => void, ...args: unknown[]) =>
  globalThis.setTimeout(fn, 0, ...args);
export const clearImmediate = (h: ReturnType<typeof globalThis.setTimeout>) => {
  globalThis.clearTimeout(h);
};
export const promises = {
  setTimeout: <T>(ms: number, value?: T) =>
    new Promise<T | undefined>((r) =>
      globalThis.setTimeout(() => {
        r(value);
      }, ms),
    ),
  setImmediate: <T>(value?: T) =>
    new Promise<T | undefined>((r) =>
      globalThis.setTimeout(() => {
        r(value);
      }, 0),
    ),
};
export default {
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  setImmediate,
  clearImmediate,
  promises,
};
