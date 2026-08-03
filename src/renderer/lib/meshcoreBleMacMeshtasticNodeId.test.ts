import { describe, expect, it } from 'vitest';

import {
  meshcoreBleMacToMeshtasticNodeId,
  shouldSuppressMeshtasticNodeHear,
} from './meshcoreBleMacMeshtasticNodeId';

describe('meshcoreBleMacToMeshtasticNodeId', () => {
  it('maps Nathan Blue MAC cc:2e:e3:da:2e:2f to 0xe3da2e2f', () => {
    expect(meshcoreBleMacToMeshtasticNodeId('cc:2e:e3:da:2e:2f')).toBe(0xe3da2e2f);
  });

  it('accepts colon-free and mixed-case MACs', () => {
    expect(meshcoreBleMacToMeshtasticNodeId('CC2EE3DA2E2F')).toBe(0xe3da2e2f);
    expect(meshcoreBleMacToMeshtasticNodeId('cc-2e-e3-da-2e-2f')).toBe(0xe3da2e2f);
  });

  it('returns null for invalid MACs', () => {
    expect(meshcoreBleMacToMeshtasticNodeId('')).toBeNull();
    expect(meshcoreBleMacToMeshtasticNodeId('aabb')).toBeNull();
    expect(meshcoreBleMacToMeshtasticNodeId('not-a-mac')).toBeNull();
  });
});

describe('shouldSuppressMeshtasticNodeHear', () => {
  it('suppresses matching node while MeshCore BLE MAC is connected', () => {
    expect(shouldSuppressMeshtasticNodeHear(0xe3da2e2f, 'cc:2e:e3:da:2e:2f')).toBe(true);
    expect(shouldSuppressMeshtasticNodeHear(3822726703, 'cc2ee3da2e2f')).toBe(true);
  });

  it('does not suppress when MeshCore BLE is disconnected', () => {
    expect(shouldSuppressMeshtasticNodeHear(0xe3da2e2f, null)).toBe(false);
    expect(shouldSuppressMeshtasticNodeHear(0xe3da2e2f, undefined)).toBe(false);
    expect(shouldSuppressMeshtasticNodeHear(0xe3da2e2f, '')).toBe(false);
  });

  it('does not suppress unrelated nodes or self-style ids while MeshCore connected', () => {
    expect(shouldSuppressMeshtasticNodeHear(0x3183af1e, 'cc:2e:e3:da:2e:2f')).toBe(false);
    expect(shouldSuppressMeshtasticNodeHear(0, 'cc:2e:e3:da:2e:2f')).toBe(false);
  });
});
