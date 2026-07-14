// @vitest-environment node
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../db-ipc-lifecycle', () => ({
  getDbForIpc: vi.fn(() => null),
  finishDbIpcHandler: vi.fn((_channel: string, err: unknown) => {
    throw err;
  }),
}));

vi.mock('../validate-ipc-sender', () => ({
  assertIpcSender: vi.fn(),
}));

import { registerReticulumDbIpcHandlers } from './reticulum-db-handlers';

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

describe('reticulum-db-handlers validation', () => {
  const handlers = new Map<string, IpcHandler>();
  const event = {} as IpcMainInvokeEvent;

  beforeAll(() => {
    registerReticulumDbIpcHandlers({
      ipcMain: {
        handle(channel: string, fn: IpcHandler) {
          handlers.set(channel, fn);
        },
      } as unknown as IpcMain,
    });
  });

  it('registers expected handlers', () => {
    expect(handlers.has('db:getReticulumMessages')).toBe(true);
    expect(handlers.has('db:saveReticulumMessage')).toBe(true);
    expect(handlers.has('db:searchReticulumMessages')).toBe(true);
    expect(handlers.has('db:clearReticulumContactDestinations')).toBe(true);
  });

  it('db:getReticulumMessages rejects oversized identityId', () => {
    const handler = handlers.get('db:getReticulumMessages');
    expect(handler?.(event, 'x'.repeat(200))).toEqual([]);
  });

  it('db:saveReticulumMessage rejects invalid payload', () => {
    const handler = handlers.get('db:saveReticulumMessage');
    expect(() =>
      handler?.(event, {
        identity_id: 'id-1',
        sender_id: 'sender',
        payload: 'x'.repeat(70000),
        timestamp: Date.now(),
      }),
    ).toThrow('payload invalid');
  });

  it('db:saveReticulumMessage returns no-op when database is unavailable', () => {
    const handler = handlers.get('db:saveReticulumMessage');
    expect(
      handler?.(event, {
        identity_id: 'id-1',
        sender_id: 'sender',
        payload: 'hello',
        timestamp: Date.now(),
        delivery_status: 'not-a-status',
      }),
    ).toEqual({ changes: 0 });
  });

  it('db:searchReticulumMessages clamps limit', () => {
    const handler = handlers.get('db:searchReticulumMessages');
    expect(handler?.(event, 'id-1', 'query', 999999)).toEqual([]);
  });
});

describe('reticulum-db-handlers SQL contracts', () => {
  it('preserves custom display names over hash-prefix aliases with case-insensitive guard', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const source = readFileSync(join(__dirname, 'reticulum-db-handlers.ts'), 'utf-8');
    expect(source).toContain('LOWER(excluded.display_name)');
    expect(source).toContain('LOWER(substr(reticulum_destinations.destination_hash, 1, 12))');
    expect(source).toContain('.replace(/[\\r\\n]+/g');
  });
});
