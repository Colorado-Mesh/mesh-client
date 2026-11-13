/**
 * Meshtastic channel security level for chat pills and Radio channel rows.
 * Matches official Meshtastic composite lock semantics (one icon, four states).
 */

export type ChannelSecurityLevel = 'encrypted' | 'open' | 'open-location' | 'open-location-uplink';

export interface ChannelSecurityInput {
  psk: Uint8Array;
  uplinkEnabled: boolean;
  positionPrecision: number;
}

/** True when the channel PSK is a real AES-128 (16) or AES-256 (32) key. */
export function channelPskIsEncrypted(psk: Uint8Array): boolean {
  return psk.length === 16 || psk.length === 32;
}

/**
 * True when the channel shares full-precision location (32 bits).
 * Coarse values such as 13 bits are intentional approximate sharing — not a precise-location warning.
 */
export function channelSharesPreciseLocation(positionPrecision: number): boolean {
  return Number.isFinite(positionPrecision) && positionPrecision >= 32;
}

/**
 * Official four-state channel security level.
 * MQTT uplink only escalates when the channel is open and shares precise location.
 */
export function channelSecurityLevel(cfg: ChannelSecurityInput): ChannelSecurityLevel {
  if (channelPskIsEncrypted(cfg.psk)) return 'encrypted';
  const precise = channelSharesPreciseLocation(cfg.positionPrecision);
  if (precise && cfg.uplinkEnabled) return 'open-location-uplink';
  if (precise) return 'open-location';
  return 'open';
}

/** i18n suffix under `channelSecurityBadges.*` for a level. */
export function channelSecurityLevelI18nKey(
  level: ChannelSecurityLevel,
): 'encrypted' | 'open' | 'openLocation' | 'openLocationUplink' {
  switch (level) {
    case 'encrypted':
      return 'encrypted';
    case 'open':
      return 'open';
    case 'open-location':
      return 'openLocation';
    case 'open-location-uplink':
      return 'openLocationUplink';
  }
}
