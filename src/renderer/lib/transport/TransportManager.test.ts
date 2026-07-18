import { describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/lib/i18n', () => ({
  default: { t: (key: string) => key },
}));

import { MESHTASTIC_CHANNEL_ROLE } from '@/shared/meshtasticUrlEncoder';
import { MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG } from '@/shared/reactionEmoji';

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

  it('uses Meshtastic tapback boolean flag on MQTT and device when emoji is set', async () => {
    const publish = vi.fn().mockResolvedValue(1234);
    window.electronAPI = {
      mqtt: { publish },
    } as unknown as typeof window.electronAPI;

    const sendText = vi.fn().mockResolvedValue(5678);
    const manager = new TransportManager({
      deviceRef: {
        current: { sendText },
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
      onStatusUpdateRef: { current: vi.fn() },
    });

    manager.sendMessage('👍', 0, undefined, 99, 1, 0x11111111, true);
    await Promise.resolve();

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '👍',
        replyId: 99,
        emoji: MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG,
      }),
    );
    expect(sendText).toHaveBeenCalledWith(
      '👍',
      'broadcast',
      true,
      0,
      99,
      MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG,
    );
  });

  it('does not MQTT uplink when from is zero', async () => {
    const publish = vi.fn().mockResolvedValue(1234);
    window.electronAPI = {
      mqtt: { publish },
    } as unknown as typeof window.electronAPI;

    const manager = new TransportManager({
      deviceRef: {
        current: { sendText: vi.fn().mockResolvedValue(1) },
      } as never,
      myNodeNumRef: { current: 0xdeadbeef },
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
      onStatusUpdateRef: { current: vi.fn() },
    });

    manager.sendMessage('hello', 0, undefined, undefined, 42, 0);
    await Promise.resolve();

    expect(publish).not.toHaveBeenCalled();
  });

  it('MQTT-only publish when connected without radio uplink enabled', async () => {
    const publish = vi.fn().mockResolvedValue(1234);
    window.electronAPI = {
      mqtt: { publish },
    } as unknown as typeof window.electronAPI;

    const manager = new TransportManager({
      deviceRef: { current: null },
      myNodeNumRef: { current: 0x11111111 },
      mqttStatusRef: { current: 'connected' },
      channelConfigsRef: {
        current: [
          {
            index: 0,
            name: 'LongFast',
            role: MESHTASTIC_CHANNEL_ROLE.PRIMARY,
            uplinkEnabled: false,
            psk: new Uint8Array([1]),
          },
        ],
      },
      isDuplicate: vi.fn(),
      onStatusUpdateRef: { current: vi.fn() },
    });

    manager.sendMessage('mqtt only', 0, undefined, undefined, 7, 0x11111111);
    await Promise.resolve();

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'mqtt only',
        from: 0x11111111,
      }),
    );
  });

  it('logs SDK sendText rejections without [object Object]', async () => {
    window.electronAPI = {
      mqtt: { publish: vi.fn() },
    } as unknown as typeof window.electronAPI;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const status = vi.fn();
    const sdkErr = { packetId: 644211103, error: 3 };
    const manager = new TransportManager({
      deviceRef: {
        current: {
          sendText: vi.fn().mockRejectedValue(sdkErr),
        },
      } as never,
      myNodeNumRef: { current: 0x11111111 },
      mqttStatusRef: { current: 'disconnected' },
      channelConfigsRef: { current: [] },
      isDuplicate: vi.fn(),
      onStatusUpdateRef: { current: status },
    });

    manager.sendMessage('hello', 0, undefined, undefined, 1, 0x11111111);
    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[useMeshtasticRuntime] sendText failed'),
    );
    expect(warnSpy.mock.calls[0]?.[0]).not.toContain('[object Object]');
    expect(status).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        finalPacketId: 644211103,
        error: 'chatPanel.routingErrors.timeout',
      }),
    );
    warnSpy.mockRestore();
  });

  it('humanizes SDK queue rejections with id + numeric routing error (PKI missing key)', async () => {
    window.electronAPI = {
      mqtt: { publish: vi.fn() },
    } as unknown as typeof window.electronAPI;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const status = vi.fn();
    // Real-world shape from @meshtastic/core queue.js: { id, error: 39 }
    const sdkErr = { id: 327029706, error: 39 };
    const manager = new TransportManager({
      deviceRef: {
        current: {
          sendText: vi.fn().mockRejectedValue(sdkErr),
        },
      } as never,
      myNodeNumRef: { current: 0x11111111 },
      mqttStatusRef: { current: 'disconnected' },
      channelConfigsRef: { current: [] },
      isDuplicate: vi.fn(),
      onStatusUpdateRef: { current: status },
    });

    manager.sendMessage('📍 location', 0, 0x22222222, undefined, 1, 0x11111111);
    await vi.waitFor(() => {
      expect(status).toHaveBeenCalled();
    });

    expect(status).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        finalPacketId: 327029706,
        error: 'chatPanel.routingErrors.pkiMissingRecipientKey',
      }),
    );
    warnSpy.mockRestore();
  });

  it('falls back to routing error name for unmapped numeric codes', async () => {
    window.electronAPI = {
      mqtt: { publish: vi.fn() },
    } as unknown as typeof window.electronAPI;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const status = vi.fn();
    const sdkErr = { id: 42, error: 38 }; // RATE_LIMIT_EXCEEDED — no chat i18n mapping
    const manager = new TransportManager({
      deviceRef: {
        current: {
          sendText: vi.fn().mockRejectedValue(sdkErr),
        },
      } as never,
      myNodeNumRef: { current: 0x11111111 },
      mqttStatusRef: { current: 'disconnected' },
      channelConfigsRef: { current: [] },
      isDuplicate: vi.fn(),
      onStatusUpdateRef: { current: status },
    });

    manager.sendMessage('hello', 0, undefined, undefined, 1, 0x11111111);
    await vi.waitFor(() => {
      expect(status).toHaveBeenCalled();
    });

    expect(status).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        finalPacketId: 42,
        error: 'RATE_LIMIT_EXCEEDED',
      }),
    );
    warnSpy.mockRestore();
  });
});
