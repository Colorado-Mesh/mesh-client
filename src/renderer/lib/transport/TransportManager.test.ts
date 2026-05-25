import { describe, expect, it, vi } from 'vitest';

import { MESHTASTIC_CHANNEL_ROLE } from '@/shared/meshtasticUrlEncoder';

import { TransportManager } from './TransportManager';

describe('TransportManager', () => {
  it('forwards replyId on MQTT and device sends', async () => {
    const publish = vi.fn().mockResolvedValue(1234);
    window.electronAPI = {
      mqtt: {
        publish,
      },
    } as unknown as typeof window.electronAPI;

    const sendText = vi.fn().mockResolvedValue(5678);
    const status = vi.fn();
    const manager = new TransportManager({
      deviceRef: {
        current: {
          sendText,
        },
      } as never,
      myNodeNumRef: { current: 0x11111111 },
      mqttStatusRef: { current: 'connected' },
      channelConfigsRef: {
        current: [
          {
            index: 0,
            name: 'LongFast',
            role: MESHTASTIC_CHANNEL_ROLE.PRIMARY,
            uplinkEnabled: true,
            psk: new Uint8Array([1]),
          },
        ],
      },
      isDuplicate: vi.fn(),
      onStatusUpdateRef: { current: status },
    });

    manager.sendMessage('reply text', 0, undefined, 4242, 99, 0x11111111);
    await Promise.resolve();

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'reply text',
        replyId: 4242,
      }),
    );
    expect(sendText).toHaveBeenCalledWith('reply text', 'broadcast', true, 0, 4242, undefined);
  });
});
