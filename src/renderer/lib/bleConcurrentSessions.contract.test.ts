/**
 * Contract: Meshtastic + MeshCore + Reticulum may hold concurrent BLE sessions to different
 * MACs; same-MAC claims conflict; disconnecting one session leaves the others intact.
 *
 * Renderer-facing surface is electronAPI (GATT + bleCoexistence). Main proxy ownership is
 * covered separately in gatt-concurrent-sessions.contract.test.ts.
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BleCoexistenceState, BlePeripheralOwner } from '@/shared/electron-api.types';

function emptyState(): BleCoexistenceState {
  return { connections: [], scanOwner: null };
}

describe('BLE concurrent sessions (mocked electronAPI)', () => {
  const connected = new Map<string, string>();
  const owners = new Map<string, BlePeripheralOwner>();

  beforeEach(() => {
    connected.clear();
    owners.clear();

    window.electronAPI = {
      ...window.electronAPI,
      connectGatt: vi.fn((sessionId: string, peripheralId: string) => {
        const mac = peripheralId.toLowerCase();
        for (const [otherSession, otherMac] of connected) {
          if (otherSession !== sessionId && otherMac === mac) {
            return Promise.resolve({
              ok: false as const,
              error: `BLE peripheral ${mac} already in use by gatt:${otherSession}`,
              code: 'peripheral_in_use',
            });
          }
        }
        const owner = owners.get(mac);
        if (owner && owner !== `gatt:${sessionId}`) {
          return Promise.resolve({
            ok: false as const,
            error: `BLE peripheral ${mac} already in use by ${owner}`,
            code: 'peripheral_in_use',
          });
        }
        connected.set(sessionId, mac);
        owners.set(mac, `gatt:${sessionId}` as BlePeripheralOwner);
        return Promise.resolve({ ok: true as const });
      }),
      disconnectGatt: vi.fn((sessionId: string) => {
        const mac = connected.get(sessionId);
        connected.delete(sessionId);
        if (mac && owners.get(mac) === `gatt:${sessionId}`) {
          owners.delete(mac);
        }
        return Promise.resolve();
      }),
      isGattConnected: vi.fn((sessionId: string) => Promise.resolve(connected.has(sessionId))),
      bleCoexistence: {
        register: vi.fn((mac: string, owner: BlePeripheralOwner) => {
          const normalized = mac.toLowerCase();
          const existing = owners.get(normalized);
          if (existing && existing !== owner) {
            return Promise.reject(
              new Error(`BLE peripheral ${normalized} already in use by ${existing}`),
            );
          }
          owners.set(normalized, owner);
          return Promise.resolve({
            connections: [...owners.entries()].map(([m, o]) => ({ mac: m, owner: o })),
            scanOwner: null,
          } satisfies BleCoexistenceState);
        }),
        unregister: vi.fn((mac: string, owner: BlePeripheralOwner) => {
          const normalized = mac.toLowerCase();
          if (owners.get(normalized) === owner) owners.delete(normalized);
          return Promise.resolve(emptyState());
        }),
        getState: vi.fn(() =>
          Promise.resolve({
            connections: [...owners.entries()].map(([mac, owner]) => ({ mac, owner })),
            scanOwner: null,
          }),
        ),
        acquireScan: vi.fn(() => Promise.resolve(emptyState())),
        releaseScan: vi.fn(() => Promise.resolve(emptyState())),
        assertCanConnect: vi.fn(() => Promise.resolve(emptyState())),
        suspendForReticulumBleConnect: vi.fn(() => Promise.resolve(emptyState())),
      },
    };
  });

  it('allows three profiles on distinct MACs (meshtastic, meshcore, reticulum)', async () => {
    await expect(
      window.electronAPI.connectGatt('meshtastic', 'AA:BB:CC:DD:EE:01'),
    ).resolves.toEqual({ ok: true });
    await expect(window.electronAPI.connectGatt('meshcore', 'AA:BB:CC:DD:EE:02')).resolves.toEqual({
      ok: true,
    });
    await expect(
      window.electronAPI.bleCoexistence.register('AA:BB:CC:DD:EE:03', 'reticulum'),
    ).resolves.toMatchObject({
      connections: expect.arrayContaining([
        expect.objectContaining({ mac: 'aa:bb:cc:dd:ee:03', owner: 'reticulum' }),
      ]),
    });

    await expect(window.electronAPI.isGattConnected('meshtastic')).resolves.toBe(true);
    await expect(window.electronAPI.isGattConnected('meshcore')).resolves.toBe(true);
    const state = await window.electronAPI.bleCoexistence.getState();
    expect(state.connections).toHaveLength(3);
  });

  it('rejects same-MAC conflict across LoRa GATT sessions', async () => {
    await window.electronAPI.connectGatt('meshtastic', 'AA:BB:CC:DD:EE:FF');
    const conflict = await window.electronAPI.connectGatt('meshcore', 'AA:BB:CC:DD:EE:FF');
    expect(conflict).toMatchObject({
      ok: false,
      error: expect.stringMatching(/already in use by gatt:meshtastic/i),
    });
    await expect(window.electronAPI.isGattConnected('meshtastic')).resolves.toBe(true);
    await expect(window.electronAPI.isGattConnected('meshcore')).resolves.toBe(false);
  });

  it('disconnecting one GATT session leaves the other connected', async () => {
    await window.electronAPI.connectGatt('meshtastic', '11:22:33:44:55:01');
    await window.electronAPI.connectGatt('meshcore', '11:22:33:44:55:02');

    await window.electronAPI.disconnectGatt('meshtastic');

    await expect(window.electronAPI.isGattConnected('meshtastic')).resolves.toBe(false);
    await expect(window.electronAPI.isGattConnected('meshcore')).resolves.toBe(true);
    expect(window.electronAPI.disconnectGatt).toHaveBeenCalledWith('meshtastic');
    expect(window.electronAPI.disconnectGatt).not.toHaveBeenCalledWith('meshcore');
  });
});
