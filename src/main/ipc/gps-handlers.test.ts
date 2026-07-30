// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../gps', () => ({
  getGpsFix: vi.fn(),
}));

vi.mock('../validate-ipc-sender', () => ({
  assertIpcSender: vi.fn(),
}));

import { getGpsFix } from '../gps';
import { assertIpcSender } from '../validate-ipc-sender';
import { registerGpsIpcHandlers } from './gps-handlers';

describe('gps-handlers', () => {
  it('registers gps:getFix with sender validation', async () => {
    const { ipcMain } = await import('electron');
    const handle = vi.mocked(ipcMain.handle);
    handle.mockClear();
    registerGpsIpcHandlers();
    expect(handle).toHaveBeenCalledWith('gps:getFix', expect.any(Function));

    const firstCall = handle.mock.calls[0];
    expect(firstCall).toBeDefined();
    const handler = firstCall[1] as (event: unknown) => Promise<unknown>;
    vi.mocked(getGpsFix).mockResolvedValueOnce({
      status: 'ok',
      lat: 1,
      lon: 2,
      accuracy: 3,
    } as never);
    const event = {};
    await expect(handler(event)).resolves.toMatchObject({ status: 'ok' });
    expect(assertIpcSender).toHaveBeenCalledWith(event, 'gps:getFix');
  });

  it('returns a shaped error when getGpsFix throws', async () => {
    const { ipcMain } = await import('electron');
    const handle = vi.mocked(ipcMain.handle);
    handle.mockClear();
    registerGpsIpcHandlers();
    const firstCall = handle.mock.calls[0];
    expect(firstCall).toBeDefined();
    const handler = firstCall[1] as (event: unknown) => Promise<unknown>;
    vi.mocked(getGpsFix).mockRejectedValueOnce(new Error('boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(handler({})).resolves.toMatchObject({
      status: 'error',
      code: 'UNKNOWN',
    });
    errSpy.mockRestore();
  });

  it('source still asserts sender before getGpsFix', () => {
    const source = readFileSync(join(__dirname, 'gps-handlers.ts'), 'utf-8');
    const idx = source.indexOf("ipcMain.handle('gps:getFix'");
    expect(idx).toBeGreaterThan(-1);
    const body = source.slice(idx, idx + 350);
    expect(body.indexOf('assertIpcSender')).toBeLessThan(body.indexOf('getGpsFix'));
  });
});
