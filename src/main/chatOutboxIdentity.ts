/**
 * Identity stored on a chat outbox row.
 * Null is an omitted legacy id and may drain on any radio.
 * A supplied id must be a nonempty string of at most 128 characters; anything else is rejected
 * so it cannot be stored as a legacy row and sent through a different identity.
 */
export function outboxIdentityIdForInsert(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 128) {
    throw new Error('chat:outbox:add: invalid identityId');
  }
  return value;
}
