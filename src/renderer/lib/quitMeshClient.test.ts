import { describe, expect, it, vi } from 'vitest';

import { quitMeshClient, quitNeedsConfirm } from './quitMeshClient';

vi.mock('./mqttDisconnectIntent', () => ({ markMqttUserDisconnect: vi.fn() }));
vi.mock('./protocolRfAutoConnectGate', () => ({ cancelProtocolRfAutoConnect: vi.fn() }));

describe('quitNeedsConfirm', () => {
  it('returns false when nothing is up and no risks', () => {
    expect(
      quitNeedsConfirm({ linkUp: false, openEmergencies: 0, pendingEmergencyMessages: 0 }),
    ).toBe(false);
  });

  it('returns true when link is up', () => {
    expect(
      quitNeedsConfirm({ linkUp: true, openEmergencies: 0, pendingEmergencyMessages: 0 }),
    ).toBe(true);
  });

  it('returns true when there are open emergencies', () => {
    expect(
      quitNeedsConfirm({ linkUp: false, openEmergencies: 1, pendingEmergencyMessages: 0 }),
    ).toBe(true);
  });

  it('returns true when there are pending emergency messages', () => {
    expect(
      quitNeedsConfirm({ linkUp: false, openEmergencies: 0, pendingEmergencyMessages: 3 }),
    ).toBe(true);
  });
});

describe('quitMeshClient', () => {
  it('cancels pending connects and calls quitApp', async () => {
    const cancelSerialSelection = vi.fn();
    const cancelProtocolRfAutoConnect = vi.fn();
    const quitApp = vi.fn().mockResolvedValue(undefined);

    const { cancelProtocolRfAutoConnect: cancelRf } = vi.mocked(
      await import('./protocolRfAutoConnectGate'),
    );
    cancelRf.mockImplementation((p) => cancelProtocolRfAutoConnect(p));

    Object.assign(window, {
      electronAPI: {
        cancelSerialSelection,
        quitApp,
        mqtt: { disconnect: vi.fn().mockResolvedValue(undefined) },
      },
    });

    await quitMeshClient(false);
    expect(cancelSerialSelection).toHaveBeenCalled();
    expect(quitApp).toHaveBeenCalled();
  });

  it('marks MQTT disconnect when requested', async () => {
    const quitApp = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const { markMqttUserDisconnect } = vi.mocked(await import('./mqttDisconnectIntent'));

    Object.assign(window, {
      electronAPI: {
        cancelSerialSelection: vi.fn(),
        quitApp,
        mqtt: { disconnect },
      },
    });

    await quitMeshClient(true);
    expect(markMqttUserDisconnect).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });

  it('swallows quitApp failure', async () => {
    const quitApp = vi.fn().mockRejectedValue(new Error('fail'));
    Object.assign(window, {
      electronAPI: {
        cancelSerialSelection: vi.fn(),
        quitApp,
        mqtt: { disconnect: vi.fn().mockResolvedValue(undefined) },
      },
    });

    await expect(quitMeshClient(false)).resolves.not.toThrow();
  });
});
