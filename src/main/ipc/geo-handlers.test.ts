// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const { resolveMock } = vi.hoisted(() => ({ resolveMock: vi.fn() }));

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app', getPath: () => '/user-data' },
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../validate-ipc-sender', () => ({
  assertIpcSender: vi.fn(),
}));

vi.mock('../geo/resolvePlace', () => ({
  PlaceResolver: class {
    resolve = resolveMock;
  },
}));

import { assertIpcSender } from '../validate-ipc-sender';
import { registerGeoIpcHandlers } from './geo-handlers';

async function getHandler() {
  const { ipcMain } = await import('electron');
  const handle = vi.mocked(ipcMain.handle);
  handle.mockClear();
  registerGeoIpcHandlers();
  expect(handle).toHaveBeenCalledWith('geo:resolvePlace', expect.any(Function));
  return handle.mock.calls[0][1] as (event: unknown, raw: unknown) => Promise<unknown>;
}

describe('geo-handlers', () => {
  it('validates the sender and the payload before resolving', async () => {
    const handler = await getHandler();
    resolveMock.mockResolvedValueOnce({ lat: 1, lon: 2, label: 'X', source: 'gazetteer' });
    const event = {};
    await expect(handler(event, { name: 'Aurora', allowOnline: false })).resolves.toMatchObject({
      source: 'gazetteer',
    });
    expect(assertIpcSender).toHaveBeenCalledWith(event, 'geo:resolvePlace');
    expect(resolveMock).toHaveBeenCalledWith({
      name: 'Aurora',
      qualifiers: [],
      allowOnline: false,
    });

    resolveMock.mockClear();
    await expect(handler(event, { name: 42 })).resolves.toBeNull();
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('returns null and logs when the resolver throws', async () => {
    const handler = await getHandler();
    resolveMock.mockRejectedValueOnce(new Error('boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(handler({}, { name: 'A', allowOnline: true })).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('source still asserts sender before resolving', () => {
    const source = readFileSync(join(__dirname, 'geo-handlers.ts'), 'utf-8');
    const idx = source.indexOf("ipcMain.handle('geo:resolvePlace'");
    const body = source.slice(idx, idx + 400);
    expect(body.indexOf('assertIpcSender')).toBeLessThan(body.indexOf('resolve('));
  });
});
