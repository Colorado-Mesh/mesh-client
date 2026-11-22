import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./serialPortRecovery', () => ({
  serialPortMatchesPersistedIdentity: vi.fn(() => true),
}));

import {
  registerMeshcomSerialDisconnectTarget,
  registerMeshcoreSerialDisconnectTarget,
  registerMeshtasticSerialDisconnectTarget,
  routeSerialServiceDisconnect,
} from './serialDisconnectRouter';
import { serialPortMatchesPersistedIdentity } from './serialPortRecovery';

describe('serialDisconnectRouter', () => {
  let caseEpochMs = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    // Each case needs a fresh debounce window (module-level lastSerialDisconnectNotifyAt).
    caseEpochMs += 10_000;
    vi.setSystemTime(caseEpochMs);
    vi.mocked(serialPortMatchesPersistedIdentity).mockReturnValue(true);
    registerMeshtasticSerialDisconnectTarget(null);
    registerMeshcoreSerialDisconnectTarget(null);
    registerMeshcomSerialDisconnectTarget(null);
  });

  afterEach(() => {
    registerMeshtasticSerialDisconnectTarget(null);
    registerMeshcoreSerialDisconnectTarget(null);
    registerMeshcomSerialDisconnectTarget(null);
    vi.useRealTimers();
  });

  it('notifies the first connected protocol target', () => {
    const meshtasticOnDisconnected = vi.fn();
    const meshcoreOnDisconnected = vi.fn();
    registerMeshtasticSerialDisconnectTarget({
      isSerialConnected: () => true,
      onDisconnected: meshtasticOnDisconnected,
    });
    registerMeshcoreSerialDisconnectTarget({
      isSerialConnected: () => true,
      onDisconnected: meshcoreOnDisconnected,
    });

    routeSerialServiceDisconnect({} as SerialPort);

    expect(meshtasticOnDisconnected).toHaveBeenCalledTimes(1);
    expect(meshcoreOnDisconnected).not.toHaveBeenCalled();
  });

  it('prefers the target whose open port matches the disconnected port', () => {
    const port = {} as SerialPort;
    const meshtasticOnDisconnected = vi.fn();
    const meshcoreOnDisconnected = vi.fn();
    registerMeshtasticSerialDisconnectTarget({
      isSerialConnected: () => true,
      getOpenSerialPort: () => ({}) as SerialPort,
      onDisconnected: meshtasticOnDisconnected,
    });
    registerMeshcoreSerialDisconnectTarget({
      isSerialConnected: () => true,
      getOpenSerialPort: () => port,
      onDisconnected: meshcoreOnDisconnected,
    });

    routeSerialServiceDisconnect(port);

    expect(meshcoreOnDisconnected).toHaveBeenCalledTimes(1);
    expect(meshtasticOnDisconnected).not.toHaveBeenCalled();
  });

  it('skips targets that are not serial-connected', () => {
    const meshcoreOnDisconnected = vi.fn();
    registerMeshtasticSerialDisconnectTarget({
      isSerialConnected: () => false,
      onDisconnected: vi.fn(),
    });
    registerMeshcoreSerialDisconnectTarget({
      isSerialConnected: () => true,
      onDisconnected: meshcoreOnDisconnected,
    });

    routeSerialServiceDisconnect({} as SerialPort);

    expect(meshcoreOnDisconnected).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the port does not match persisted identity', () => {
    vi.mocked(serialPortMatchesPersistedIdentity).mockReturnValue(false);
    const onDisconnected = vi.fn();
    registerMeshtasticSerialDisconnectTarget({
      isSerialConnected: () => true,
      onDisconnected,
    });

    routeSerialServiceDisconnect({} as SerialPort);

    expect(onDisconnected).not.toHaveBeenCalled();
  });

  it('debounces duplicate disconnect notifications within 500ms', () => {
    const onDisconnected = vi.fn();
    registerMeshtasticSerialDisconnectTarget({
      isSerialConnected: () => true,
      onDisconnected,
    });

    routeSerialServiceDisconnect({} as SerialPort);
    routeSerialServiceDisconnect({} as SerialPort);
    expect(onDisconnected).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    routeSerialServiceDisconnect({} as SerialPort);
    expect(onDisconnected).toHaveBeenCalledTimes(2);
  });

  it('accepts optional getOpenSerialPort and releaseHold on registration', async () => {
    const releaseHold = vi.fn().mockResolvedValue(undefined);
    const port = {} as SerialPort;
    registerMeshtasticSerialDisconnectTarget({
      isSerialConnected: () => true,
      getOpenSerialPort: () => port,
      onDisconnected: vi.fn(),
      releaseHold,
    });
    const { getRegisteredSerialDisconnectTargets } = await import('./serialDisconnectRouter');
    const target = getRegisteredSerialDisconnectTargets().get('meshtastic');
    expect(target?.getOpenSerialPort?.()).toBe(port);
    await target?.releaseHold?.();
    expect(releaseHold).toHaveBeenCalledTimes(1);
  });
});
