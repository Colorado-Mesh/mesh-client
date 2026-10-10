import type { MeshProtocol } from '../../shared/meshProtocol';
import type { TakStyleSettings, TakUnitStyle } from '../../shared/tak-types';
import { matchTakUnitFilter } from '../../shared/takUnitFilterMatch';
import { advertisedTakStyle, TAK_RELAY_STYLE } from './advertised-style';
import { cotCallsignFor, type CotRelayNode } from './cot-converter';

export interface ResolvedTakStyle {
  style: TakUnitStyle;
  callsign: string;
  /** A user filter, not the node's advertised role, chose the style. */
  matched: boolean;
}

/**
 * Style and callsign for a relayed node: the first enabled filter whose pattern matches the
 * callsign (then the long name), else the style the node advertises, with the configured relay
 * icon on advertised relays. Returns null when no filter matches and unmatched nodes are not
 * relayed.
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
  const advertised = advertisedTakStyle(node, protocol);
  const style =
    advertised === TAK_RELAY_STYLE && settings.relayIconsetPath
      ? { ...advertised, iconsetPath: settings.relayIconsetPath }
      : advertised;
  return { style, callsign, matched: false };
}
