/** MeshCore unset channel PSK (16 zero bytes). */
export const MESHCORE_UNCONFIGURED_CHANNEL_SECRET_HEX = '00000000000000000000000000000000';

export interface MeshcoreChatChannelSource {
  index: number;
  name: string;
  secret?: Uint8Array;
}

function channelSecretHex(secret: Uint8Array): string {
  return Array.from(secret)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Channel slots with a non-zero PSK — matches Chat channel pills (see App `chatChannels`). */
export function meshcoreConfiguredChatChannels(
  channels: readonly MeshcoreChatChannelSource[],
): { index: number; name: string }[] {
  return channels
    .filter((ch) => {
      const secret = ch.secret;
      return (
        secret instanceof Uint8Array &&
        secret.length === 16 &&
        channelSecretHex(secret) !== MESHCORE_UNCONFIGURED_CHANNEL_SECRET_HEX
      );
    })
    .map((ch) => ({ index: ch.index, name: ch.name }));
}

export function meshcoreConfiguredChannelIndexSet(
  channels: readonly MeshcoreChatChannelSource[],
): ReadonlySet<number> {
  return new Set(meshcoreConfiguredChatChannels(channels).map((c) => c.index));
}
