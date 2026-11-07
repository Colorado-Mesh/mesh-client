import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it } from 'vitest';

import { OFFLINE_MESHCORE_IDENTITY_ID } from '@/renderer/lib/offlineProtocolIdentities';
import { meshcoreProtocol } from '@/renderer/lib/protocols/MeshCoreProtocol';
import { setConnection, useConnectionStore } from '@/renderer/stores/connectionStore';
import { getIdentity, useIdentityStore } from '@/renderer/stores/identityStore';
import { upsertNode, useNodeStore } from '@/renderer/stores/nodeStore';

import {
  formatScheduledBroadcastIdentityLegend,
  isScheduledBroadcastIdentityConnected,
  resolveScheduledBroadcastRadioName,
} from './identityLabel';

function englishT(): TFunction {
  return ((key: string, opts?: Record<string, unknown>) => {
    if (key === 'weather.protocol.meshcore') return 'MeshCore';
    if (key === 'weather.protocol.meshtastic') return 'Meshtastic';
    if (key === 'scheduledBroadcasts.identityConnected' && opts) {
      return `${String(opts.name)} (connected)`;
    }
    if (key === 'scheduledBroadcasts.identityDisconnected' && opts) {
      return `${String(opts.name)} (offline)`;
    }
    return key;
  }) as TFunction;
}

beforeEach(() => {
  useConnectionStore.setState({ connections: {} });
  useNodeStore.setState({ nodes: {} });
  useIdentityStore.setState({
    identities: {
      [OFFLINE_MESHCORE_IDENTITY_ID]: {
        id: OFFLINE_MESHCORE_IDENTITY_ID,
        protocol: meshcoreProtocol,
        signature: '',
        transports: [],
        createdAt: 0,
        lastSeenAt: 0,
        selfNodeNum: 42,
      },
    },
    activeIdentityId: OFFLINE_MESHCORE_IDENTITY_ID,
  });
});

describe('isScheduledBroadcastIdentityConnected', () => {
  it('is true for RF connected/configured and Meshtastic MQTT', () => {
    expect(isScheduledBroadcastIdentityConnected(OFFLINE_MESHCORE_IDENTITY_ID)).toBe(false);
    setConnection(OFFLINE_MESHCORE_IDENTITY_ID, { status: 'connected', myNodeNum: 42 });
    expect(isScheduledBroadcastIdentityConnected(OFFLINE_MESHCORE_IDENTITY_ID)).toBe(true);
  });
});

describe('resolveScheduledBroadcastRadioName', () => {
  const t = englishT();

  it('prefers self-node longName and never returns offline-* id slices', () => {
    const identity = getIdentity(OFFLINE_MESHCORE_IDENTITY_ID);
    expect(identity).not.toBeNull();
    if (!identity) return;
    expect(resolveScheduledBroadcastRadioName(identity, t)).toBe('MeshCore');
    upsertNode(OFFLINE_MESHCORE_IDENTITY_ID, {
      nodeId: 42,
      longName: 'Peak Relay',
      shortName: 'PR',
    });
    expect(resolveScheduledBroadcastRadioName(identity, t)).toBe('Peak Relay');
    expect(resolveScheduledBroadcastRadioName(identity, t)).not.toContain('offline');
  });
});

describe('formatScheduledBroadcastIdentityLegend', () => {
  const t = englishT();

  it('shows connected status with the radio name', () => {
    const identity = getIdentity(OFFLINE_MESHCORE_IDENTITY_ID);
    expect(identity).not.toBeNull();
    if (!identity) return;
    upsertNode(OFFLINE_MESHCORE_IDENTITY_ID, {
      nodeId: 42,
      longName: 'Peak Relay',
      shortName: 'PR',
    });
    setConnection(OFFLINE_MESHCORE_IDENTITY_ID, { status: 'configured', myNodeNum: 42 });
    expect(formatScheduledBroadcastIdentityLegend(identity, t)).toBe('Peak Relay (connected)');
  });

  it('shows offline status when disconnected', () => {
    const identity = getIdentity(OFFLINE_MESHCORE_IDENTITY_ID);
    expect(identity).not.toBeNull();
    if (!identity) return;
    expect(formatScheduledBroadcastIdentityLegend(identity, t)).toBe('MeshCore (offline)');
  });
});
