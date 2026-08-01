// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handle = vi.fn();
const on = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: unknown[]) => handle(...args),
    on: (...args: unknown[]) => on(...args),
  },
}));

vi.mock('./validate-ipc-sender', () => ({
  assertIpcSender: vi.fn(),
}));

import {
  applyLinuxWebBluetoothCancelIpc,
  registerLinuxWebBluetoothCancelIpcHandlers,
} from './linuxWebBluetoothCancelIpc';
import { linuxWebBluetoothDeviceSelection } from './linuxWebBluetoothDeviceSelection';
import { assertIpcSender } from './validate-ipc-sender';

function makeEvent(url: string | null): { senderFrame: { url: string } | null } {
  return { senderFrame: url == null ? null : { url } };
}

describe('linuxWebBluetoothCancelIpc', () => {
  beforeEach(() => {
    handle.mockReset();
    on.mockReset();
    vi.mocked(assertIpcSender).mockReset();
    vi.mocked(assertIpcSender).mockImplementation(() => {});
    linuxWebBluetoothDeviceSelection.clear();
    registerLinuxWebBluetoothCancelIpcHandlers();
  });

  function getCancelHandler(): (event: unknown, generation: unknown) => { cancelled: boolean } {
    const call = handle.mock.calls.find((c) => c[0] === 'bluetooth-device-cancel');
    expect(call).toBeDefined();
    return call![1] as (event: unknown, generation: unknown) => { cancelled: boolean };
  }

  function getCancelledHandler(): (event: unknown, generation: unknown) => void {
    const call = on.mock.calls.find((c) => c[0] === 'bluetooth-device-cancelled');
    expect(call).toBeDefined();
    return call![1] as (event: unknown, generation: unknown) => void;
  }

  it('rejects unauthorized senders on both cancel channels', () => {
    vi.mocked(assertIpcSender).mockImplementation((_event, channel) => {
      throw new Error(`${channel}: unauthorized sender`);
    });
    const invokeHandler = getCancelHandler();
    const sendHandler = getCancelledHandler();
    const badEvent = makeEvent(null);

    expect(() => invokeHandler(badEvent, 1)).toThrow(
      'bluetooth-device-cancel: unauthorized sender',
    );
    expect(() => {
      sendHandler(badEvent, 1);
    }).toThrow('bluetooth-device-cancelled: unauthorized sender');
    expect(assertIpcSender).toHaveBeenCalledWith(badEvent, 'bluetooth-device-cancel');
    expect(assertIpcSender).toHaveBeenCalledWith(badEvent, 'bluetooth-device-cancelled');
  });

  it('invoke cancel returns { cancelled } and respects generation', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const cb = vi.fn();
    const { generation } = linuxWebBluetoothDeviceSelection.beginOrMergeDiscovery(
      [{ deviceId: 'aa:bb' }],
      cb,
    );
    const invokeHandler = getCancelHandler();
    const event = makeEvent('file:///index.html');

    expect(invokeHandler(event, generation + 1)).toEqual({ cancelled: false });
    expect(cb).not.toHaveBeenCalled();
    expect(linuxWebBluetoothDeviceSelection.hasPendingSelection()).toBe(true);

    expect(invokeHandler(event, generation)).toEqual({ cancelled: true });
    expect(cb).toHaveBeenCalledWith('');
    expect(linuxWebBluetoothDeviceSelection.hasPendingSelection()).toBe(false);

    expect(assertIpcSender).toHaveBeenCalledWith(event, 'bluetooth-device-cancel');
    debug.mockRestore();
  });

  it('fire-and-forget cancelled force-clears when generation is omitted', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const cb = vi.fn();
    linuxWebBluetoothDeviceSelection.beginOrMergeDiscovery([{ deviceId: 'aa:bb' }], cb);
    const sendHandler = getCancelledHandler();
    const event = makeEvent('file:///index.html');

    sendHandler(event, undefined);
    expect(cb).toHaveBeenCalledWith('');
    expect(linuxWebBluetoothDeviceSelection.hasPendingSelection()).toBe(false);
    expect(assertIpcSender).toHaveBeenCalledWith(event, 'bluetooth-device-cancelled');
    debug.mockRestore();
  });

  it('applyLinuxWebBluetoothCancelIpc returns cancelled boolean for force path', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(applyLinuxWebBluetoothCancelIpc(undefined)).toEqual({ cancelled: false });
    const cb = vi.fn();
    linuxWebBluetoothDeviceSelection.beginOrMergeDiscovery([{ deviceId: 'aa:bb' }], cb);
    expect(applyLinuxWebBluetoothCancelIpc(null)).toEqual({ cancelled: true });
    expect(cb).toHaveBeenCalledWith('');
    debug.mockRestore();
  });
});
