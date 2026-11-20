import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./MeshComProtocol', () => ({
  meshcomProtocol: {
    type: 'meshcom',
    createDevice: vi.fn(),
    destroyDevice: vi.fn(),
    subscribe: vi.fn(),
    identitySignature: vi.fn(() => 'meshcom:test'),
    sendMessage: vi.fn(),
  },
}));

describe('meshcomProtocolLoader', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('registers MeshCom on first ensureMeshcomProtocolLoaded', async () => {
    const { getProtocolForType } = await import('./protocolRegistry');
    const { ensureMeshcomProtocolLoaded } = await import('./meshcomProtocolLoader');
    expect(getProtocolForType('meshcom')).toBeNull();
    const protocol = await ensureMeshcomProtocolLoaded();
    expect(protocol.type).toBe('meshcom');
    expect(getProtocolForType('meshcom')).toBe(protocol);
    const again = await ensureMeshcomProtocolLoaded();
    expect(again).toBe(protocol);
  });
});
