import {
  APP_PANEL_INDEX,
  CHAT_PANEL_INDEX,
  GAMES_PANEL_INDEX,
  NODES_PANEL_INDEX,
  NOMAD_NETWORK_PANEL_INDEX,
  REMOTE_PANEL_INDEX,
  ROOMS_PANEL_INDEX,
  RRC_PANEL_INDEX,
} from './appTabMappings';
import type { RfConnectAutomaticFn, RfConnectFn } from './rfConnectionTypes';

/** Keep-alive flags cleared and re-armed together when a protocol switch commits. */
export interface ProtocolVisitFlags {
  chat: boolean;
  rooms: boolean;
  games: boolean;
  rrc: boolean;
  remote: boolean;
  nomad: boolean;
  peers: boolean;
  app: boolean;
}

const CLEARED_VISIT_FLAGS: ProtocolVisitFlags = {
  chat: false,
  rooms: false,
  games: false,
  rrc: false,
  remote: false,
  nomad: false,
  peers: false,
  app: false,
};

/**
 * Visit flags for one protocol commit. A protocol change clears every flag, then arms
 * the destination panel. The same protocol only arms the destination. Peers stay off
 * unless the destination protocol has a peers list (Meshtastic nodes are not peers).
 * A null panel (cancel, or a tab that does not exist) leaves the base flags as they are.
 */
export function visitFlagsForProtocolCommit(
  current: ProtocolVisitFlags,
  panel: number | null,
  protocolChanged: boolean,
  enablePeers: boolean,
): ProtocolVisitFlags {
  const base: ProtocolVisitFlags = protocolChanged ? { ...CLEARED_VISIT_FLAGS } : { ...current };
  if (panel === CHAT_PANEL_INDEX) return { ...base, chat: true };
  if (panel === ROOMS_PANEL_INDEX) return { ...base, rooms: true };
  if (panel === GAMES_PANEL_INDEX) return { ...base, games: true };
  if (panel === RRC_PANEL_INDEX) return { ...base, rrc: true };
  if (panel === REMOTE_PANEL_INDEX) return { ...base, remote: true };
  if (panel === NOMAD_NETWORK_PANEL_INDEX) return { ...base, nomad: true };
  if (panel === APP_PANEL_INDEX) return { ...base, app: true };
  if (panel === NODES_PANEL_INDEX && enablePeers) return { ...base, peers: true };
  return base;
}

let protocolSwitchGeneration = 0;

/** Latest protocol change wins. A newer call makes earlier transition callbacks no-ops. */
export function beginProtocolSwitch(): number {
  protocolSwitchGeneration += 1;
  return protocolSwitchGeneration;
}

export function isCurrentProtocolSwitch(id: number): boolean {
  return id === protocolSwitchGeneration;
}

export function resetProtocolSwitchGenerationForTests(): void {
  protocolSwitchGeneration = 0;
}

/** Connect handlers ignored until the protocol switch commit finishes. */
export const ignoreProtocolSwitchConnect: RfConnectFn = () => Promise.resolve();

export const ignoreProtocolSwitchAutoConnect: RfConnectAutomaticFn = () => Promise.resolve();
