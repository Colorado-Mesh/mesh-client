import type { MeshProtocol } from '../../shared/meshProtocol';
import type { TakStyleSettings, TakUnitStyle } from '../../shared/tak-types';
import { matchTakUnitFilter } from '../../shared/takUnitFilterMatch';
import { advertisedTakStyle } from './advertised-style';
import { cotCallsignFor, type CotRelayNode } from './cot-converter';

export interface ResolvedTakStyle {
  style: TakUnitStyle;
  callsign: string;
  /** A user filter, not the node's advertised role, chose the style. */
  matched: boolean;
}

/**
 * Style and callsign for a relayed node: the first enabled filter whose pattern matches the
 * callsign (then the long name), else the style the node advertises. Returns null when no filter
 * matches and unmatched nodes are not relayed.
 */
export function resolveTakStyle(
  settings: TakStyleSettings,
  node: CotRelayNode,
  protocol: MeshProtocol,
): ResolvedTakStyle | null {
  const callsign = cotCallsignFor(node, protocol);
  const match = matchTakUnitFilter(settings.filters, callsign, node.long_name || '');
  if (match) return { style: match.filter.style, callsign: match.callsign, matched: true };
  if (!settings.sendUnmatched) return null;
  return { style: advertisedTakStyle(node, protocol), callsign, matched: false };
}
