import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MeshcoreContactFlagConnection } from '../../lib/meshcore/meshcoreContactFlags';
import type { MeshCoreContactRaw } from '../../lib/meshcore/meshcoreHookTypes';
import { pubkeyToNodeId } from '../../lib/meshcoreUtils';
import { useMeshcoreCompanionRemote } from './useMeshcoreCompanionRemote';

function contact(flags: number): MeshCoreContactRaw {
  const publicKey = new Uint8Array(32);
  publicKey[0] = 0x77;
  return {
    publicKey,
    type: 1,
    advName: 'peer',
    lastAdvert: 0,
    advLat: 0,
    advLon: 0,
    flags,
    outPathLen: 0,
    outPath: new Uint8Array(64),
  };
}

describe('useMeshcoreCompanionRemote', () => {
  it('sends remote CLI as a companion target and keeps caller options', async () => {
    const sendRepeaterCliCommand = vi.fn(() => Promise.resolve('> v1.18.0'));
    const { result } = renderHook(() =>
      useMeshcoreCompanionRemote({ connRef: { current: null }, sendRepeaterCliCommand }),
    );
    await expect(result.current.sendRemoteCli(5, 'ver', { confirmedDanger: true })).resolves.toBe(
      '> v1.18.0',
    );
    expect(sendRepeaterCliCommand).toHaveBeenCalledWith(5, 'ver', {
      confirmedDanger: true,
      target: 'companion',
    });
  });

  it('reads and toggles flag 0x10 on the radio contact', async () => {
    const c = contact(0x01);
    const addOrUpdateContact = vi.fn((...args: unknown[]) => {
      c.flags = args[2] as number;
      return Promise.resolve();
    });
    const conn: MeshcoreContactFlagConnection = {
      getContacts: () => Promise.resolve([c]),
      addOrUpdateContact,
    };
    const nodeId = pubkeyToNodeId(c.publicKey);
    const { result } = renderHook(() =>
      useMeshcoreCompanionRemote({
        connRef: { current: conn },
        sendRepeaterCliCommand: vi.fn(),
      }),
    );
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    await expect(result.current.getRemoteCliAllowed(nodeId)).resolves.toBe(false);
    await expect(result.current.setRemoteCliAllowed(nodeId, true)).resolves.toBe(true);
    expect(c.flags).toBe(0x11);
    await expect(result.current.setRemoteCliAllowed(nodeId, false)).resolves.toBe(false);
    expect(c.flags).toBe(0x01);
    await expect(result.current.getRemoteCliAllowed(123)).resolves.toBeNull();
  });

  it('rejects when not connected', async () => {
    const { result } = renderHook(() =>
      useMeshcoreCompanionRemote({ connRef: { current: null }, sendRepeaterCliCommand: vi.fn() }),
    );
    await expect(result.current.getRemoteCliAllowed(1)).rejects.toThrow(/not connected/i);
  });
});
