// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { outboxIdentityIdForInsert } from './chatOutboxIdentity';

describe('outboxIdentityIdForInsert', () => {
  it('keeps a legacy omission as null and a valid id unchanged', () => {
    expect(outboxIdentityIdForInsert(undefined)).toBeNull();
    expect(outboxIdentityIdForInsert(null)).toBeNull();
    expect(outboxIdentityIdForInsert('')).toBeNull();
    expect(outboxIdentityIdForInsert('id-a')).toBe('id-a');
    expect(outboxIdentityIdForInsert('x'.repeat(128))).toBe('x'.repeat(128));
  });

  it('rejects a nonempty id that is not a short string', () => {
    expect(() => outboxIdentityIdForInsert('x'.repeat(129))).toThrow(/invalid identityId/);
    expect(() => outboxIdentityIdForInsert(12)).toThrow(/invalid identityId/);
  });
});
