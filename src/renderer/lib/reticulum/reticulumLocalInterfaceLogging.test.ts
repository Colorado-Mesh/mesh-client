import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatReticulumInterfaceStateEvent,
  logReticulumInterfaceStateEvent,
  logReticulumLocalInterfaceHealthChanges,
  resetReticulumLocalInterfaceHealthSnapshotForTests,
} from './reticulumLocalInterfaceLogging';

const heltec = {
  id: 'heltec',
  name: 'Heltec V3',
  type: 'rnode',
  enabled: true,
  status: 'down',
  serial_port: '/dev/cu.usbserial-7',
};

describe('reticulumLocalInterfaceLogging', () => {
  afterEach(() => {
    resetReticulumLocalInterfaceHealthSnapshotForTests();
    vi.restoreAllMocks();
  });

  it('logs BLE RNode offline transitions at warn level', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bleRnode = {
      ...heltec,
      id: 'rnode-ble',
      serial_port: 'ble://aa:bb:cc:dd:ee:ff',
      status: 'down',
    };

    logReticulumLocalInterfaceHealthChanges([bleRnode], []);
    logReticulumLocalInterfaceHealthChanges([bleRnode], []);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('local interface offline');
    expect(warn.mock.calls[0]?.[0]).toContain('transport=ble');
    expect(warn.mock.calls[0]?.[0]).toContain('ble://aa:bb:cc:dd:ee:ff');
  });

  it('logs recovery at debug and stale USB ports at warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

    logReticulumLocalInterfaceHealthChanges([heltec], []);
    expect(warn).toHaveBeenCalledTimes(1);

    logReticulumLocalInterfaceHealthChanges([{ ...heltec, status: 'up' }], ['/dev/cu.usbserial-7']);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('local interface online'));

    logReticulumLocalInterfaceHealthChanges(
      [{ ...heltec, serial_port: '/dev/cu.missing', status: 'down' }],
      ['/dev/cu.usbserial-1'],
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('local interface stale port'));
  });

  it('formats interface.state payloads and warns on ble_peer_failed', () => {
    expect(
      formatReticulumInterfaceStateEvent({
        action: 'ble_peer_failed',
        interface_id: 'peer-1',
        error: 'adapter busy',
      }),
    ).toBe('action=ble_peer_failed id=peer-1 error=adapter busy');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logReticulumInterfaceStateEvent({
      action: 'ble_peer_failed',
      interface_id: 'peer-1',
      error: 'adapter busy',
    });
    expect(warn).toHaveBeenCalledWith(
      '[useReticulumRuntime] interface.state action=ble_peer_failed id=peer-1 error=adapter busy',
    );
  });
});
