/** Minimal `assert` shim (only reached through dependency code paths). */
function assert(value: unknown, message?: string | Error): asserts value {
  if (!value) throw message instanceof Error ? message : new Error(message ?? 'Assertion failed');
}
assert.ok = assert;
assert.equal = (a: unknown, b: unknown, m?: string) => {
  assert(a == b, m ?? `${String(a)} == ${String(b)}`);
};
assert.strictEqual = (a: unknown, b: unknown, m?: string) => {
  assert(a === b, m ?? `${String(a)} === ${String(b)}`);
};
assert.notStrictEqual = (a: unknown, b: unknown, m?: string) => {
  assert(a !== b, m);
};
assert.deepEqual = (a: unknown, b: unknown, m?: string) => {
  assert(JSON.stringify(a) === JSON.stringify(b), m);
};
assert.deepStrictEqual = assert.deepEqual;
assert.fail = (m?: string): never => {
  throw new Error(m ?? 'Failed');
};
assert.strict = assert;
export default assert;
export const ok = assert;
export const strict = assert;
