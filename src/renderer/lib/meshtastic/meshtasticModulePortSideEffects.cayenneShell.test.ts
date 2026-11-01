import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordCayennePacket, useCayenneTelemetryStore } from '../../stores/cayenneTelemetryStore';
import { useRemoteShellStore } from '../../stores/remoteShellStore';
import { packetRouter } from '../drivers/PacketRouter';
import { decodeCayenneLpp } from './cayenneLpp';
import {
  attachMeshtasticModulePortSideEffects,
  type MeshtasticModulePortSideEffectsDeps,
} from './meshtasticModulePortSideEffects';
import { emptyRemoteShellFrame, encodeRemoteShellFrame } from './remoteShell';
import {
  openRemoteShell,
  resetRemoteShellSessionForTests,
  setRemoteShellSender,
} from './remoteShellSession';

vi.mock('../identityByProtocol', () => ({ getIdentityIdForProtocol: () => 'id-1' }));

// Only touchLastData is exercised; every other setter is a no-op for these ports.
const deps = new Proxy<Record<string, unknown>>(
  { touchLastData: vi.fn() },
  { get: (target, key: string) => target[key] ?? vi.fn() },
) as unknown as MeshtasticModulePortSideEffectsDeps;

function dispatchPort(portLabel: string, from: number, data: Uint8Array, timestamp = 1000) {
  packetRouter.dispatch(
    { type: 'meshtastic_module_port', payload: { portLabel, from, data, timestamp } },
    'id-1',
  );
}

describe('CAYENNE_APP / REMOTE_SHELL_APP module-port wiring', () => {
  afterEach(() => {
    useCayenneTelemetryStore.setState({ byIdentity: {} });
    resetRemoteShellSessionForTests();
    vi.restoreAllMocks();
  });

  it('decodes CAYENNE_APP payloads into the telemetry store', () => {
    const detach = attachMeshtasticModulePortSideEffects('id-1', deps);
    dispatchPort('cayenne', 9, new Uint8Array([0x01, 0x67, 0x01, 0x10]), 55);
    const series = useCayenneTelemetryStore
      .getState()
      .byIdentity['id-1'].get(9)
      ?.series.get('temperature#1');
    expect(series?.points).toEqual([{ timestamp: 55, value: 27.2 }]);
    detach();
  });

  it('ignores CAYENNE_APP payloads that decode to nothing', () => {
    const detach = attachMeshtasticModulePortSideEffects('id-1', deps);
    dispatchPort('cayenne', 9, new Uint8Array([0x01, 0xee, 0x00]));
    expect(useCayenneTelemetryStore.getState().byIdentity['id-1']).toBeUndefined();
    detach();
  });

  it('routes REMOTE_SHELL_APP frames to the active session', () => {
    setRemoteShellSender(() => Promise.resolve());
    const detach = attachMeshtasticModulePortSideEffects('id-1', deps);
    openRemoteShell(0x42);
    const { sessionId } = useRemoteShellStore.getState();
    dispatchPort(
      'remoteShell',
      0x42,
      encodeRemoteShellFrame(emptyRemoteShellFrame('openOk', sessionId)),
    );
    expect(useRemoteShellStore.getState().phase).toBe('open');
    detach();
  });

  it('drops the shell session and Cayenne history when the radio detaches', () => {
    setRemoteShellSender(() => Promise.resolve());
    const detach = attachMeshtasticModulePortSideEffects('id-1', deps);
    openRemoteShell(0x42);
    recordCayennePacket('id-1', {
      from: 1,
      timestamp: 1,
      decoded: decodeCayenneLpp(new Uint8Array([0x01, 0x67, 0x00, 0x64])),
    });
    detach();
    expect(useRemoteShellStore.getState().phase).toBe('idle');
    expect(useCayenneTelemetryStore.getState().byIdentity['id-1']).toBeUndefined();
  });
});
