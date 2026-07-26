/**
 * Typed `PacketRouter` subscription helpers.
 *
 * Every post-router side effect used to hand-roll the same guard — compare the
 * routed identity, narrow `event.type`, then read `event.payload`. These
 * wrappers do that once against the {@link DomainEventPayloadMap} registry so a
 * handler receives an already-narrowed payload.
 *
 * Ordering contract (see `PacketRouter.dispatch`): store mutations run before
 * any listener, and listeners run in registration order. A module that
 * registers several handlers through {@link attachTypedPacketListeners} gets
 * one router listener, so its handlers keep their relative order with respect
 * to listeners registered by other modules.
 */
import type { DomainEventPayloadMap, DomainEventType } from '../protocols/Protocol';
import type { IdentityId } from '../types';
import { packetRouter } from './PacketRouter';

export type TypedPacketHandler<T extends DomainEventType> = (
  payload: DomainEventPayloadMap[T],
  identityId: IdentityId,
) => void;

export type TypedPacketHandlers = {
  [T in DomainEventType]?: TypedPacketHandler<T>;
};

/** Subscribe to one event type for one identity. Returns a detach function. */
export function attachTypedPacketListener<T extends DomainEventType>(
  identityId: IdentityId,
  type: T,
  handler: TypedPacketHandler<T>,
): () => void {
  return packetRouter.addTypedListener(type, (event, routedIdentityId) => {
    if (routedIdentityId !== identityId || event.type !== type) return;
    handler(event.payload as DomainEventPayloadMap[T], identityId);
  });
}

/**
 * Subscribe to several event types for one identity using a single router
 * listener, preserving dispatch order relative to other modules.
 */
export function attachTypedPacketListeners(
  identityId: IdentityId,
  handlers: TypedPacketHandlers,
): () => void {
  const types = Object.keys(handlers) as DomainEventType[];
  return packetRouter.addTypedListeners(types, (event, routedIdentityId) => {
    if (routedIdentityId !== identityId) return;
    const handler = handlers[event.type] as TypedPacketHandler<DomainEventType> | undefined;
    handler?.(event.payload, identityId);
  });
}
