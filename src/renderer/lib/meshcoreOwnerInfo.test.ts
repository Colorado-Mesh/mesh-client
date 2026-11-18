import { describe, expect, it, vi } from 'vitest';

import {
  meshcoreOwnerInfoLines,
  meshcoreOwnerInfoSupported,
  parseMeshcoreOwnerInfoReply,
  readMeshcoreOwnerInfo,
} from './meshcoreOwnerInfo';

describe('meshcoreOwnerInfo', () => {
  it('parses an ok reply', () => {
    const entry = parseMeshcoreOwnerInfoReply('> Operator', 1_700_000_000_000);
    expect(entry).toEqual({ status: 'ok', text: 'Operator', fetchedAt: 1_700_000_000_000 });
  });

  it.each(['>', '> '])('treats %j as empty', (reply) => {
    expect(parseMeshcoreOwnerInfoReply(reply, 10)).toEqual({ status: 'empty', fetchedAt: 10 });
  });

  it.each(['??: owner.info', 'Unknown command', 'Error: unsupported'])(
    'detects unsupported reply %j',
    (reply) => {
      expect(parseMeshcoreOwnerInfoReply(reply, 20)).toEqual({
        status: 'unsupported',
        fetchedAt: 20,
      });
    },
  );

  it.each(['OK', ''])('rejects invalid reply %j', (reply) => {
    expect(parseMeshcoreOwnerInfoReply(reply, 30)).toEqual({
      status: 'error',
      fetchedAt: 30,
      reason: 'invalid-reply',
    });
  });

  it('splits owner info lines on pipes and newlines', () => {
    expect(meshcoreOwnerInfoLines('A|B|C')).toEqual(['A', 'B', 'C']);
    expect(meshcoreOwnerInfoLines('A|B|')).toEqual(['A', 'B']);
    expect(meshcoreOwnerInfoLines('A\nB')).toEqual(['A', 'B']);
  });

  it('supports CommonCLI contact types only', () => {
    expect(meshcoreOwnerInfoSupported('Repeater')).toBe(true);
    expect(meshcoreOwnerInfoSupported('Room')).toBe(true);
    expect(meshcoreOwnerInfoSupported('Sensor')).toBe(true);
    expect(meshcoreOwnerInfoSupported('Chat')).toBe(false);
    expect(meshcoreOwnerInfoSupported(undefined)).toBe(false);
  });

  it('does not call send without an admin password', async () => {
    const send = vi.fn();
    const entry = await readMeshcoreOwnerInfo({
      hwModel: 'Repeater',
      hasAdminPassword: false,
      send,
    });
    expect(entry.status).toBe('needs-password');
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['Chat', undefined] as const)(
    'does not call send for unsupported hwModel %j',
    async (hwModel) => {
      const send = vi.fn();
      const entry = await readMeshcoreOwnerInfo({
        hwModel,
        hasAdminPassword: true,
        send,
      });
      expect(entry.status).toBe('unsupported');
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('maps auth and timeout failures to quiet error reasons', async () => {
    const auth = await readMeshcoreOwnerInfo({
      hwModel: 'Repeater',
      hasAdminPassword: true,
      send: () => Promise.reject(new Error('authentication failed')),
    });
    expect(auth).toMatchObject({ status: 'error', reason: 'auth' });

    const timeout = await readMeshcoreOwnerInfo({
      hwModel: 'Sensor',
      hasAdminPassword: true,
      send: () => Promise.reject(new Error('companion CLI command timed out')),
    });
    expect(timeout).toMatchObject({ status: 'error', reason: 'timeout' });
  });

  it('never throws from readMeshcoreOwnerInfo', async () => {
    await expect(
      readMeshcoreOwnerInfo({
        hwModel: 'Room',
        hasAdminPassword: true,
        send: () => Promise.reject(new Error('boom')),
      }),
    ).resolves.toMatchObject({ status: 'error', reason: 'failed' });
  });
});
