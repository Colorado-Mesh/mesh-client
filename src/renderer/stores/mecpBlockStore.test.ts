import { beforeEach, describe, expect, it } from 'vitest';

import { isMecpSenderBlocked, MAX_MECP_BLOCKED_SENDERS, useMecpBlockStore } from './mecpBlockStore';

describe('mecpBlockStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useMecpBlockStore.setState({ blocked: {} });
  });

  it('blocks per protocol and sender, and unblocks', () => {
    useMecpBlockStore.getState().block('meshtastic', '9', 'Spammer');
    expect(isMecpSenderBlocked('meshtastic', '9')).toBe(true);
    expect(isMecpSenderBlocked('meshcore', '9')).toBe(false);
    expect(useMecpBlockStore.getState().blocked['meshtastic:9']?.label).toBe('Spammer');

    useMecpBlockStore.getState().unblock('meshtastic', '9');
    expect(isMecpSenderBlocked('meshtastic', '9')).toBe(false);
  });

  it('caps the list, dropping the oldest entries', () => {
    const blocked: Record<
      string,
      { protocol: 'meshtastic'; senderId: string; label: string; createdAt: number }
    > = {};
    for (let i = 0; i < MAX_MECP_BLOCKED_SENDERS; i++) {
      blocked[`meshtastic:${i}`] = {
        protocol: 'meshtastic',
        senderId: String(i),
        label: String(i),
        createdAt: i,
      };
    }
    useMecpBlockStore.setState({ blocked });
    useMecpBlockStore.getState().block('meshtastic', 'new', 'New');
    const state = useMecpBlockStore.getState().blocked;
    expect(Object.keys(state)).toHaveLength(MAX_MECP_BLOCKED_SENDERS);
    expect(state['meshtastic:0']).toBeUndefined();
    expect(state['meshtastic:new']).toBeDefined();
  });

  it('persists to localStorage and drops malformed rows on rehydrate', async () => {
    useMecpBlockStore.getState().block('meshcore', '7', 'Seven');
    expect(localStorage.getItem('mesh-client:mecpBlockedSenders')).toContain('meshcore:7');

    localStorage.setItem(
      'mesh-client:mecpBlockedSenders',
      JSON.stringify({
        state: {
          blocked: {
            good: { protocol: 'meshtastic', senderId: '5', label: 'Five', createdAt: 1 },
            badProto: { protocol: 'zigbee', senderId: '6', label: 'x', createdAt: 1 },
            badId: { protocol: 'meshtastic', senderId: '', label: 'x', createdAt: 1 },
          },
        },
        version: 1,
      }),
    );
    await useMecpBlockStore.persist.rehydrate();
    expect(Object.keys(useMecpBlockStore.getState().blocked)).toEqual(['meshtastic:5']);
  });
});
