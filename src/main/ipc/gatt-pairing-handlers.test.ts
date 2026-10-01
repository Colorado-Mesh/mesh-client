// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../validate-ipc-sender', () => ({
  assertIpcSender: vi.fn(),
}));

import { ipcMain } from 'electron';

import { BleScanBusyError } from '../ble-coexistence-coordinator';
import { assertIpcSender } from '../validate-ipc-sender';
import { type GattPairingIpcDeps, registerGattPairingIpcHandlers } from './gatt-pairing-handlers';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

function setup(platform: NodeJS.Platform, overrides: Partial<GattPairingIpcDeps> = {}) {
  const handle = vi.mocked(ipcMain.handle);
  handle.mockClear();
  const proxy = {
    pairState: vi.fn().mockResolvedValue({ ok: true, paired: true }),
    pair: vi.fn().mockResolvedValue({ ok: true }),
    unpair: vi.fn().mockResolvedValue({ ok: true }),
    isRnodeBondRecoveryExclusive: vi.fn().mockReturnValue(false),
  };
  const withGattScan = vi.fn((op: () => Promise<unknown>) => op());
  registerGattPairingIpcHandlers({
    proxy,
    withGattScan: withGattScan as GattPairingIpcDeps['withGattScan'],
    isQuitting: () => false,
    platform: () => platform,
    ...overrides,
  });
  const handlers = new Map(handle.mock.calls.map(([ch, fn]) => [ch, fn as Handler]));
  const get = (ch: string) => {
    const fn = handlers.get(ch);
    if (!fn) throw new Error(`missing handler ${ch}`);
    return fn;
  };
  return { proxy, withGattScan, get };
}

describe('gatt-pairing-handlers', () => {
  beforeEach(() => {
    vi.mocked(assertIpcSender).mockClear();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('registers all three channels', () => {
    const { get } = setup('win32');
    expect(() => get('gatt:pair-state')).not.toThrow();
    expect(() => get('gatt:pair')).not.toThrow();
    expect(() => get('gatt:unpair')).not.toThrow();
  });

  it.each(['linux', 'darwin'] as const)('returns unsupported on %s', async (platform) => {
    const { proxy, get } = setup(platform);
    for (const [ch, args] of [
      ['gatt:pair-state', ['ef:4f:4f:1c:23:73']],
      ['gatt:pair', ['ef:4f:4f:1c:23:73', '123456']],
      ['gatt:unpair', ['ef:4f:4f:1c:23:73']],
    ] as const) {
      await expect(get(ch)({}, ...args)).resolves.toMatchObject({
        ok: false,
        code: 'unsupported',
      });
      expect(assertIpcSender).toHaveBeenCalledWith({}, ch);
    }
    expect(proxy.pairState).not.toHaveBeenCalled();
    expect(proxy.pair).not.toHaveBeenCalled();
    expect(proxy.unpair).not.toHaveBeenCalled();
  });

  it('forwards on win32 through the GATT scan lock', async () => {
    const { proxy, withGattScan, get } = setup('win32');
    await expect(get('gatt:pair-state')({}, 'ef:4f:4f:1c:23:73')).resolves.toEqual({
      ok: true,
      paired: true,
    });
    await expect(get('gatt:pair')({}, 'ef:4f:4f:1c:23:73', '123456')).resolves.toEqual({
      ok: true,
    });
    await expect(get('gatt:unpair')({}, 'ef:4f:4f:1c:23:73')).resolves.toEqual({ ok: true });
    expect(proxy.pairState).toHaveBeenCalledWith('ef:4f:4f:1c:23:73');
    expect(proxy.pair).toHaveBeenCalledWith('ef:4f:4f:1c:23:73', '123456');
    expect(proxy.unpair).toHaveBeenCalledWith('ef:4f:4f:1c:23:73');
    expect(withGattScan).toHaveBeenCalledTimes(3);
  });

  it('rejects a bad sender before touching the proxy', async () => {
    const { proxy, get } = setup('win32');
    vi.mocked(assertIpcSender).mockImplementationOnce(() => {
      throw new Error('untrusted sender');
    });
    await expect(get('gatt:pair')({}, 'ef:4f:4f:1c:23:73', '123456')).rejects.toThrow(
      'untrusted sender',
    );
    expect(proxy.pair).not.toHaveBeenCalled();
  });

  it('validates peripheral id and PIN', async () => {
    const { proxy, get } = setup('win32');
    await expect(get('gatt:pair-state')({}, 42)).rejects.toThrow(/peripheralId/);
    await expect(get('gatt:unpair')({}, '')).rejects.toThrow(/peripheralId/);
    for (const pin of ['12', '1234567', '12a456', 123456]) {
      await expect(get('gatt:pair')({}, 'ef:4f:4f:1c:23:73', pin)).resolves.toMatchObject({
        ok: false,
        code: 'invalid_pin',
      });
    }
    expect(proxy.pair).not.toHaveBeenCalled();
  });

  it('never logs the PIN', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { get } = setup('win32');
    await get('gatt:pair')({}, 'ef:4f:4f:1c:23:73', '987654');
    expect(JSON.stringify(debug.mock.calls)).not.toContain('987654');
  });

  it('maps scan-busy and thrown errors to failures', async () => {
    const { get } = setup('win32', {
      withGattScan: () => Promise.reject(new BleScanBusyError('reticulum')),
    });
    await expect(get('gatt:pair')({}, 'ef:4f:4f:1c:23:73', '123456')).resolves.toMatchObject({
      ok: false,
      code: 'scan_busy',
    });
  });

  it('blocks during quit and RNode bond recovery', async () => {
    const quitting = setup('win32', { isQuitting: () => true });
    await expect(quitting.get('gatt:pair-state')({}, 'ef:4f:4f:1c:23:73')).resolves.toMatchObject({
      ok: false,
      code: 'app_quitting',
    });
    const recovering = setup('win32');
    recovering.proxy.isRnodeBondRecoveryExclusive.mockReturnValue(true);
    await expect(
      recovering.get('gatt:pair')({}, 'ef:4f:4f:1c:23:73', '123456'),
    ).resolves.toMatchObject({ ok: false, code: 'rnode_bond_recovery' });
    expect(recovering.proxy.pair).not.toHaveBeenCalled();
  });
});
