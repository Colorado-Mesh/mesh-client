import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ChannelConfig } from '@/renderer/stores/deviceStore';
import {
  setDeviceChannels,
  upsertMeshcoreChannel,
  useDeviceStore,
} from '@/renderer/stores/deviceStore';
import {
  resetLiveChannelKeyStoreForTests,
  setLiveChannelKeys,
} from '@/renderer/stores/liveChannelKeyStore';

import {
  formatScheduledBroadcastChannelLabel,
  formatScheduledBroadcastRrcRoomLabel,
  formatScheduledBroadcastTargetLabel,
  lookupChannelName,
} from './channelLabel';

function englishT(): TFunction {
  return ((key: string, opts?: Record<string, unknown>) => {
    if (key === 'scheduledBroadcasts.targetKind.meshtasticChannel') return 'Meshtastic channel';
    if (key === 'scheduledBroadcasts.targetKind.meshcoreChannel') return 'MeshCore channel';
    if (key === 'scheduledBroadcasts.channelNamed' && opts) {
      return `${String(opts.kind)} ${String(opts.index)}: ${String(opts.name)}`;
    }
    if (key === 'scheduledBroadcasts.rrcRoomNamed' && opts) {
      return `${String(opts.hub)} — ${String(opts.room)}`;
    }
    return key;
  }) as TFunction;
}

beforeEach(() => {
  resetLiveChannelKeyStoreForTests();
  useDeviceStore.setState({ devices: {} });
});

describe('lookupChannelName', () => {
  it('reads Meshtastic names from channels then channelConfigs', () => {
    const adminConfig: ChannelConfig = {
      index: 1,
      name: 'Admin',
      role: 1,
      psk: new Uint8Array(),
      uplinkEnabled: true,
      downlinkEnabled: true,
      positionPrecision: 0,
    };
    setDeviceChannels('mt', [{ index: 0, name: 'LongFast' }], [adminConfig]);
    expect(lookupChannelName('meshtastic-channel', 'mt', 0)).toBe('LongFast');
    expect(lookupChannelName('meshtastic-channel', 'mt', 1)).toBe('Admin');
    expect(lookupChannelName('meshtastic-channel', 'mt', 2)).toBe('');
  });

  it('reads MeshCore names from meshcoreChannels', () => {
    upsertMeshcoreChannel('mc', {
      index: 0,
      name: 'Public',
      key: new Uint8Array(16),
    });
    expect(lookupChannelName('meshcore-channel', 'mc', 0)).toBe('Public');
    expect(lookupChannelName('meshcore-channel', 'mc', 1)).toBe('');
  });
});

describe('formatScheduledBroadcastChannelLabel', () => {
  const t = englishT();

  it('formats a named Meshtastic channel', () => {
    setDeviceChannels('mt', [{ index: 0, name: 'LongFast' }], []);
    expect(
      formatScheduledBroadcastChannelLabel(
        {
          kind: 'meshtastic-channel',
          identityId: 'mt',
          channelIndex: 0,
        },
        t,
      ),
    ).toBe('Meshtastic channel 0: LongFast');
  });

  it('formats a named MeshCore channel', () => {
    upsertMeshcoreChannel('mc', {
      index: 2,
      name: 'Emcomm',
      key: new Uint8Array(16),
    });
    expect(
      formatScheduledBroadcastChannelLabel(
        {
          kind: 'meshcore-channel',
          identityId: 'mc',
          channelIndex: 2,
        },
        t,
      ),
    ).toBe('MeshCore channel 2: Emcomm');
  });

  it('falls back to kind + index when unnamed', () => {
    expect(
      formatScheduledBroadcastChannelLabel(
        {
          kind: 'meshtastic-channel',
          identityId: 'mt',
          channelIndex: 3,
        },
        t,
      ),
    ).toBe('Meshtastic channel 3');
  });

  it('remaps channelKey to the live slot before looking up the name', () => {
    setLiveChannelKeys('meshtastic', {
      radioNodeId: 1,
      keyByIndex: { 0: 'other', 3: 'aabb' },
    });
    setDeviceChannels(
      'mt',
      [
        { index: 0, name: 'WrongSlot' },
        { index: 3, name: 'Remapped' },
      ],
      [],
    );
    expect(
      formatScheduledBroadcastChannelLabel(
        {
          kind: 'meshtastic-channel',
          identityId: 'mt',
          channelIndex: 0,
          channelKey: 'aabb',
        },
        t,
      ),
    ).toBe('Meshtastic channel 3: Remapped');
  });

  it('omits the name when channelKey resolution fails', () => {
    setLiveChannelKeys('meshtastic', {
      radioNodeId: 1,
      keyByIndex: { 0: 'other' },
    });
    setDeviceChannels('mt', [{ index: 0, name: 'LongFast' }], []);
    expect(
      formatScheduledBroadcastChannelLabel(
        {
          kind: 'meshtastic-channel',
          identityId: 'mt',
          channelIndex: 0,
          channelKey: 'gone',
        },
        t,
      ),
    ).toBe('Meshtastic channel 0');
  });
});

describe('formatScheduledBroadcastTargetLabel', () => {
  const t = englishT();

  it('refreshes channel labels and passes room labels through', () => {
    setDeviceChannels('mt', [{ index: 0, name: 'LongFast' }], []);
    expect(
      formatScheduledBroadcastTargetLabel(
        {
          kind: 'meshtastic-channel',
          identityId: 'mt',
          label: 'stale',
          enabled: true,
          channelIndex: 0,
        },
        t,
      ),
    ).toBe('Meshtastic channel 0: LongFast');
    expect(
      formatScheduledBroadcastTargetLabel(
        {
          kind: 'meshcore-room',
          identityId: 'mc',
          label: 'BBS',
          enabled: true,
          roomPubKeyHex: 'abcd',
        },
        t,
      ),
    ).toBe('BBS');
  });

  it('formats RRC rooms with hub override or hash prefix', () => {
    expect(
      formatScheduledBroadcastRrcRoomLabel(
        {
          hubDestHash: 'aabbccddeeff00112233445566778899',
          room: 'lobby',
          label: 'lobby',
        },
        t,
        'Denver Hub',
      ),
    ).toBe('Denver Hub — lobby');
    expect(
      formatScheduledBroadcastTargetLabel(
        {
          kind: 'rrc-room',
          identityId: 'rns',
          label: 'stale',
          enabled: true,
          hubDestHash: 'aabbccddeeff00112233445566778899',
          room: 'lobby',
        },
        t,
        undefined,
        'Denver Hub',
      ),
    ).toBe('Denver Hub — lobby');
  });
});
