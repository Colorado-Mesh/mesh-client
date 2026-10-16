import type { MeshProtocol } from '../../shared/meshProtocol';
import type { TakNodeKind, TakStyleSettings, TakUnitStyle } from '../../shared/tak-types';
import { matchTakUnitFilter } from '../../shared/takUnitFilterMatch';
import { advertisedNodeKind, advertisedTakStyle } from './advertised-style';
import { cotCallsignFor, type CotRelayNode } from './cot-converter';

export interface ResolvedTakStyle {
  style: TakUnitStyle;
  callsign: string;
  /** A user filter, not the node's advertised role, chose the style. */
  matched: boolean;
}

/** The configured icon for nodes of `kind`: repeaters and room servers each have their own. */
function kindIcon(settings: TakStyleSettings, kind: TakNodeKind): string | undefined {
  if (kind === 'repeater') return settings.relayIconsetPath;
  if (kind === 'room') return settings.roomIconsetPath;
  return undefined;
}

/**
 * Style and callsign for a relayed node: the first enabled filter whose name, node kind and
 * protocol conditions it meets, else the style the node advertises. Repeaters and room servers
 * then get their kind's configured icon either way, as MeshCore TAK Bridge draws them, so a
 * filter can set their team and role without losing the icon. Returns null when no filter
 * matches and unmatched nodes are not relayed.
 */
export function resolveTakStyle(
  settings: TakStyleSettings,
  node: CotRelayNode,
  protocol: MeshProtocol,
): ResolvedTakStyle | null {
  const callsign = cotCallsignFor(node, protocol);
  const kind = advertisedNodeKind(node, protocol);
  const icon = kindIcon(settings, kind);
  const withIcon = (style: TakUnitStyle): TakUnitStyle =>
    icon ? { ...style, iconsetPath: icon } : style;
  const match = matchTakUnitFilter(settings.filters, callsign, node.long_name || '', {
    kind,
    protocol,
  });
  if (match) {
    return { style: withIcon(match.filter.style), callsign: match.callsign, matched: true };
  }
  if (!settings.sendUnmatched) return null;
  return { style: withIcon(advertisedTakStyle(node, protocol)), callsign, matched: false };
}
