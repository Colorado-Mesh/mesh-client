import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyGet = vi.fn();
const proxyDelete = vi.fn();

vi.stubGlobal('window', {
  electronAPI: {
    reticulum: {
      proxyGet,
      proxyDelete,
    },
  },
});

import { RETICULUM_PACKET_RING_CAPACITY, useReticulumPacketStore } from './reticulumPacketStore';

describe('reticulumPacketStore', () => {
  beforeEach(() => {
    proxyGet.mockReset();
    proxyDelete.mockReset();
    useReticulumPacketStore.setState({ packets: [] });
  });

  it('trims ring buffer to capacity', () => {
    for (let i = 0; i < RETICULUM_PACKET_RING_CAPACITY + 5; i++) {
      useReticulumPacketStore.getState().appendPacket({
        ts: i,
        direction: 'rx',
        interfaceId: 1,
        interfaceName: 'tcp',
        raw: new Uint8Array([i & 0xff]),
      });
    }
    expect(useReticulumPacketStore.getState().packets).toHaveLength(RETICULUM_PACKET_RING_CAPACITY);
    expect(useReticulumPacketStore.getState().packets[0]?.ts).toBe(5);
  });

  it('hydrates from sidecar GET /api/v1/packets', async () => {
    proxyGet.mockResolvedValue({
      packets: [
        {
          ts: 1000,
          direction: 'rx',
          interface_id: 2,
          interface_name: 'rnode',
          raw_hex: '0102',
        },
      ],
    });
    await useReticulumPacketStore.getState().hydrateFromSidecar();
    expect(useReticulumPacketStore.getState().packets).toHaveLength(1);
    expect(useReticulumPacketStore.getState().packets[0]?.interfaceName).toBe('rnode');
  });
});
