/**
 * Back-compat re-exports for RRC DM helpers.
 * Prefer `@/renderer/lib/rrcDmRoom` for new code.
 */

export {
  isRrcWhisperPeerHash,
  rrcDmDisplayLabel as rrcWhisperDisplayLabel,
  type RrcDmPeer as RrcWhisperPeer,
} from '@/renderer/lib/rrcDmRoom';
