/**
 * A protocol turned off in App → Protocols must not reopen a remembered BLE session on wake.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import { saveLastConnection } from '../lib/lastConnectionStorage';
import { tryGetMeshcoreSession } from '../lib/sessions/meshcoreSession';
import { tryGetMeshtasticSession } from '../lib/sessions/meshtasticSession';
import * as systemPowerState from '../lib/systemPowerState';
import { useMeshcoreRuntime } from '../runtime/useMeshcoreRuntime';
import { useMeshtasticRuntime } from '../runtime/useMeshtasticRuntime';

const BLE_ID = '00112233445566778899aabbccddeeff';

describe('hidden protocol wake', () => {
  let connectSpy: ReturnType<typeof vi.spyOn>;
  let delaySpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    connectSpy = vi.spyOn(connectionDriver, 'connect').mockResolvedValue('identity-test');
    delaySpy = vi
      .spyOn(systemPowerState, 'delayUnlessSuspended')
      .mockImplementation(() => new Promise(() => {}));
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    window.electronAPI.onPowerSuspend = vi.fn(() => () => {});
    window.electronAPI.onPowerResume = vi.fn(() => () => {});
    window.electronAPI.mqtt.powerSuspend = vi.fn().mockResolvedValue(undefined);
    window.electronAPI.mqtt.powerResume = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    localStorage.removeItem('mesh-client:lastConnection:meshtastic');
    localStorage.removeItem('mesh-client:lastConnection:meshcore');
    consoleWarnSpy.mockRestore();
    consoleDebugSpy.mockRestore();
    connectSpy.mockRestore();
    delaySpy.mockRestore();
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
  });

  it('reconnects a remembered Meshtastic BLE session on wake when the protocol is enabled', async () => {
    saveLastConnection('meshtastic', { type: 'ble', bleDeviceId: BLE_ID });
    const { result } = renderHook(() => useMeshtasticRuntime());

    await act(async () => {
      result.current.onPowerResume();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('reconnecting');
    });
    expect(consoleDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining('rehydrated reconnect params from storage'),
    );
  });

  it.each(['meshtastic', 'meshcore'] as const)(
    'does not rehydrate a remembered %s BLE session on wake after the hide latch',
    async (protocol) => {
      saveLastConnection(protocol, { type: 'ble', bleDeviceId: BLE_ID });
      const { result } = renderHook(() => {
        const meshtastic = useMeshtasticRuntime();
        const meshcore = useMeshcoreRuntime();
        return protocol === 'meshtastic' ? meshtastic : meshcore;
      });
      const session =
        protocol === 'meshtastic' ? tryGetMeshtasticSession() : tryGetMeshcoreSession();
      expect(session?.latchExplicitDisconnect?.()).toBe(true);

      await act(async () => {
        result.current.onPowerResume();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.state.status).toBe('disconnected');
      expect(connectSpy).not.toHaveBeenCalled();
      expect(delaySpy).not.toHaveBeenCalled();
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('skip reconnect (user disconnect)'),
      );
    },
  );
});
