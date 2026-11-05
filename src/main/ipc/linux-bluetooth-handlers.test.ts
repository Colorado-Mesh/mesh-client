// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../validate-ipc-sender', () => ({
  assertIpcSender: vi.fn(),
}));

import { ipcMain } from 'electron';

import type { LinuxBluezClient } from '../linux-bluez';
import { assertIpcSender } from '../validate-ipc-sender';
import { registerLinuxBluetoothIpcHandlers } from './linux-bluetooth-handlers';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

function setup(client: Partial<LinuxBluezClient> = {}) {
  const handle = vi.mocked(ipcMain.handle);
  handle.mockClear();
  const full: LinuxBluezClient = {
    getDeviceInfoText: vi.fn().mockResolvedValue('Paired: yes'),
    pairWithPin: vi.fn().mockResolvedValue(undefined),
    removeDevice: vi.fn().mockResolvedValue(undefined),
    setTrusted: vi.fn().mockResolvedValue(undefined),
    startDiscovery: vi.fn().mockResolvedValue(undefined),
    stopDiscovery: vi.fn().mockResolvedValue(undefined),
    connectDevice: vi.fn().mockResolvedValue(undefined),
    ...client,
  };
  registerLinuxBluetoothIpcHandlers({ client: full });
  const handlers = new Map(handle.mock.calls.map(([ch, fn]) => [ch, fn as Handler]));
  const get = (ch: string) => {
    const fn = handlers.get(ch);
    if (!fn) throw new Error(`missing handler ${ch}`);
    return fn;
  };
  return { client: full, get };
}

describe('linux-bluetooth-handlers', () => {
  beforeEach(() => {
    vi.mocked(assertIpcSender).mockClear();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('registers all bluetooth-* channels', () => {
    const { get } = setup();
    for (const ch of [
      'bluetooth-unpair',
      'bluetooth-start-scan',
      'bluetooth-stop-scan',
      'bluetooth-pair',
      'bluetooth-connect',
      'bluetooth-untrust',
      'bluetooth-get-info',
    ]) {
      expect(() => get(ch)).not.toThrow();
    }
  });

  it('validates MAC on bluetooth-pair and asserts sender', async () => {
    const { client, get } = setup();
    await expect(get('bluetooth-pair')({}, 'bad', '123456')).rejects.toThrow(/invalid MAC/);
    expect(assertIpcSender).toHaveBeenCalledWith({}, 'bluetooth-pair');
    expect(client.pairWithPin).not.toHaveBeenCalled();
  });

  it('requires a 6-digit PIN string', async () => {
    const { client, get } = setup();
    await expect(get('bluetooth-pair')({}, 'AA:BB:CC:DD:EE:FF', '12')).rejects.toThrow(
      /exactly 6 digits/,
    );
    expect(client.pairWithPin).not.toHaveBeenCalled();
  });

  it('forwards a valid pair call', async () => {
    const { client, get } = setup();
    await expect(get('bluetooth-pair')({}, 'AA:BB:CC:DD:EE:FF', '123456')).resolves.toBeUndefined();
    expect(client.pairWithPin).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', '123456');
  });

  it('returns get-info text', async () => {
    const { get } = setup({
      getDeviceInfoText: vi.fn().mockResolvedValue('Device AA:BB:CC:DD:EE:FF\nPaired: no'),
    });
    await expect(get('bluetooth-get-info')({}, 'AA:BB:CC:DD:EE:FF')).resolves.toContain(
      'Paired: no',
    );
  });

  it('treats untrust failures as best-effort', async () => {
    const { get } = setup({
      setTrusted: vi.fn().mockRejectedValue(new Error('gone')),
    });
    await expect(get('bluetooth-untrust')({}, 'AA:BB:CC:DD:EE:FF')).resolves.toBeUndefined();
  });

  it('does not reject stop-scan failures', async () => {
    const { get } = setup({
      stopDiscovery: vi.fn().mockRejectedValue(new Error('busy')),
    });
    await expect(get('bluetooth-stop-scan')({})).resolves.toBeUndefined();
  });
});
