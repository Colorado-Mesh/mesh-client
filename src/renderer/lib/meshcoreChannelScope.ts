import { md5 } from 'js-md5';

import { bytesToHex } from '@/shared/hexBytes';

import { FLOOD_SCOPE_OVERRIDE_UNSCOPED } from './chatPanelProtocolStorage';
import type { MeshcoreChatChannelSource } from './meshcoreConfiguredChatChannels';
import { normalizeMeshcoreFloodScopeHashtag } from './meshcoreFloodScope';
import { isValidMeshcoreFloodScopeHashtag } from './meshcoreFloodScopePresetsStorage';

/** Bind a preference to the discovered radio and channel contents, never just a reused slot. */
export function meshcoreChannelScopeKey(
  radioSignature: string | undefined,
  channel: MeshcoreChatChannelSource | undefined,
): string | null {
  if (!radioSignature || !/^meshcore:pk:[0-9a-f]{64}$/i.test(radioSignature)) return null;
  if (!channel || channel.secret?.length !== 16) return null;
  // A content fingerprint, not authentication. Keep the PSK out of localStorage keys.
  const fingerprint = md5(JSON.stringify([channel.name, bytesToHex(channel.secret)]));
  return `channel:${radioSignature}:${channel.index}:${fingerprint}`;
}

export function meshcoreScopeOverrideFromQr(regionScope?: string): string {
  if (regionScope === '') return FLOOD_SCOPE_OVERRIDE_UNSCOPED;
  if (!regionScope?.trim()) return '';
  const normalized = normalizeMeshcoreFloodScopeHashtag(regionScope);
  return isValidMeshcoreFloodScopeHashtag(normalized) ? normalized : '';
}

/** Named scopes use the standard field; explicit Unscoped is a Mesh Hub extension. */
export function meshcoreScopeOverrideForQr(override: string): {
  regionScope?: string;
  unscoped?: boolean;
} {
  if (!override) return {};
  return override === FLOOD_SCOPE_OVERRIDE_UNSCOPED
    ? { unscoped: true }
    : { regionScope: override };
}

export function effectiveMeshcoreChannelScope(override: string, radioScope: string): string {
  return override === FLOOD_SCOPE_OVERRIDE_UNSCOPED
    ? ''
    : normalizeMeshcoreFloodScopeHashtag(override || radioScope);
}
