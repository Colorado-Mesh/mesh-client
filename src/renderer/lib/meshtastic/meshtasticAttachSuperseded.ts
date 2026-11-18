import { errLikeToLogString } from '../errLikeToLogString';

/** Thrown by `attachRfSession` when a newer connect bumped reconnect generation mid-configure. */
export const MESHTASTIC_ATTACH_SUPERSEDED_MESSAGE = 'Attach superseded during configure';

/**
 * True when a Meshtastic connect/attach was abandoned because a newer session already owns the
 * link. Must not run full `handleRfConnectFailure` teardown — that would kill the live session.
 */
export function isMeshtasticAttachSupersededError(err: unknown): boolean {
  return errLikeToLogString(err).includes(MESHTASTIC_ATTACH_SUPERSEDED_MESSAGE);
}
