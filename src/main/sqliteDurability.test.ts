import { describe, expect, it, vi } from 'vitest';

import { withFullSqliteSync } from './sqliteDurability';

const MODE_NUMBER: Record<string, number> = {
  OFF: 0,
  NORMAL: 1,
  FULL: 2,
  EXTRA: 3,
};

/** Minimal sqlite handle: `pragma('synchronous', { simple: true })` reads, `pragma('synchronous = X')` writes. */
function makeDb(initialMode = 1): {
  db: { pragma: ReturnType<typeof vi.fn> };
  mode: () => number;
} {
  let current = initialMode;
  const pragma = vi.fn((statement: unknown) => {
    if (typeof statement === 'string' && statement.startsWith('synchronous = ')) {
      current = MODE_NUMBER[statement.slice('synchronous = '.length).trim()] ?? current;
      return undefined;
    }
    return current;
  });
  return { db: { pragma }, mode: () => current };
}

describe('withFullSqliteSync', () => {
  it('runs the operation with FULL durability then restores the previous mode', () => {
    const { db, mode } = makeDb(1);
    let modeInside = -1;
    const result = withFullSqliteSync(db as never, () => {
      modeInside = mode();
      return 'done';
    });
    expect(result).toBe('done');
    expect(modeInside).toBe(MODE_NUMBER.FULL);
    expect(mode()).toBe(MODE_NUMBER.NORMAL);
  });

  it('restores the mode even when the operation throws', () => {
    const { db, mode } = makeDb(0);
    expect(() =>
      withFullSqliteSync(db as never, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(mode()).toBe(MODE_NUMBER.OFF);
  });

  it('maps every known previous mode back to its name', () => {
    for (const [name, value] of Object.entries(MODE_NUMBER)) {
      const { db, mode } = makeDb(value);
      withFullSqliteSync(db as never, () => undefined);
      expect(mode()).toBe(value);
      // FULL is only skipped when the previous mode already was FULL.
      const restoreCall = db.pragma.mock.calls.at(-1)?.[0] as string;
      expect(restoreCall).toBe(`synchronous = ${name}`);
    }
  });

  it('throws when the current mode cannot be determined', () => {
    const db = { pragma: vi.fn(() => undefined) };
    expect(() => withFullSqliteSync(db as never, () => 'done')).toThrow(
      'Cannot determine SQLite synchronous mode',
    );
  });
});
