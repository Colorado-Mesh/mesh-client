/**
 * Meshtastic channel security indicators for chat channel pills.
 * Mirrors RadioPanel PSK / position / MQTT uplink classification without
 * expanding shared MessageStatus.
 */
export type ChannelPskStrength = 'none' | 'simple' | 'aes128' | 'aes256' | 'unknown';

export type ChannelSecurityBadgeKind =
  'pskWeak' | 'pskAes128' | 'pskAes256' | 'preciseLocation' | 'mqttUplink';

export interface ChannelSecurityInput {
  psk: Uint8Array;
  uplinkEnabled: boolean;
  positionPrecision: number;
}

export function channelPskStrength(psk: Uint8Array): ChannelPskStrength {
  if (psk.length === 0 || (psk.length === 1 && psk[0] === 0)) return 'none';
  if (psk.length === 1) return 'simple';
  if (psk.length === 16) return 'aes128';
  if (psk.length === 32) return 'aes256';
  return 'unknown';
}

/** True when the channel shares more than coarse/shared location bits. */
export function channelSharesPreciseLocation(positionPrecision: number): boolean {
  return Number.isFinite(positionPrecision) && positionPrecision > 0;
}

/** Ordered badge kinds for a channel (weakest / riskiest first). */
export function channelSecurityBadgeKinds(cfg: ChannelSecurityInput): ChannelSecurityBadgeKind[] {
  const kinds: ChannelSecurityBadgeKind[] = [];
  const strength = channelPskStrength(cfg.psk);
  if (strength === 'none' || strength === 'simple' || strength === 'unknown') {
    kinds.push('pskWeak');
  } else if (strength === 'aes128') {
    kinds.push('pskAes128');
  } else {
    kinds.push('pskAes256');
  }
  if (channelSharesPreciseLocation(cfg.positionPrecision)) {
    kinds.push('preciseLocation');
  }
  if (cfg.uplinkEnabled) {
    kinds.push('mqttUplink');
  }
  return kinds;
}
