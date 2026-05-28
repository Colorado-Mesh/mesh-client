import { describe, expect, it } from 'vitest';

import type { MeshNode } from '../types';
import {
  MESHTASTIC_NODEINFO_AWAIT_MS,
  meshtasticNodeAwaitingNodeInfo,
} from './meshtasticNodeAwaitingNodeInfo';

function stubNode(overrides: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: 0x51f7e502,
    long_name: '',
    short_name: '',
    hw_model: '',
    battery: 0,
    snr: 0,
    rssi: 0,
    last_heard: 0,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

describe('meshtasticNodeAwaitingNodeInfo', () => {
  const nowMs = 1_700_000_000_000;

  it('returns false for nodes with display identity', () => {
    expect(
      meshtasticNodeAwaitingNodeInfo(stubNode({ long_name: 'Alice' }), {
        isConnected: true,
        nowMs,
      }),
    ).toBe(false);
  });

  it('returns false for chat-only stubs heard outside the await window', () => {
    expect(
      meshtasticNodeAwaitingNodeInfo(
        stubNode({ last_heard: nowMs - MESHTASTIC_NODEINFO_AWAIT_MS - 1 }),
        { isConnected: true, nowMs },
      ),
    ).toBe(false);
  });

  it('returns true for recent identity-less traffic while the radio is connected', () => {
    expect(
      meshtasticNodeAwaitingNodeInfo(stubNode({ last_heard: nowMs - 60_000 }), {
        isConnected: true,
        nowMs,
      }),
    ).toBe(true);
  });

  it('returns false when the radio is disconnected', () => {
    expect(
      meshtasticNodeAwaitingNodeInfo(stubNode({ last_heard: nowMs - 60_000 }), {
        isConnected: false,
        nowMs,
      }),
    ).toBe(false);
  });
});
