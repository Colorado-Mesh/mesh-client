import { describe, expect, it } from 'vitest';

import { reticulumInterfaceChangeRequiresStackRestart } from './reticulumInterfaceStackRestart';

describe('reticulumInterfaceChangeRequiresStackRestart', () => {
  it('requires restart for interface types that are not hot-applied', () => {
    expect(reticulumInterfaceChangeRequiresStackRestart('rnode')).toBe(true);
    expect(reticulumInterfaceChangeRequiresStackRestart('rnode_multi')).toBe(true);
    expect(reticulumInterfaceChangeRequiresStackRestart('kiss')).toBe(true);
    expect(reticulumInterfaceChangeRequiresStackRestart('ble_peer')).toBe(true);
    expect(reticulumInterfaceChangeRequiresStackRestart('tcp')).toBe(true);
    expect(reticulumInterfaceChangeRequiresStackRestart('udp')).toBe(true);
    expect(reticulumInterfaceChangeRequiresStackRestart('i2p')).toBe(true);
    expect(reticulumInterfaceChangeRequiresStackRestart('auto')).toBe(true);
    expect(reticulumInterfaceChangeRequiresStackRestart('pipe')).toBe(true);
  });

  it('requires restart when serial, radio, or connect fields change', () => {
    expect(
      reticulumInterfaceChangeRequiresStackRestart(undefined, { serial_port: 'ble://aa' }),
    ).toBe(true);
    expect(
      reticulumInterfaceChangeRequiresStackRestart(undefined, { frequency: 914_875_000 }),
    ).toBe(true);
    expect(reticulumInterfaceChangeRequiresStackRestart(undefined, { host: '127.0.0.1' })).toBe(
      true,
    );
    expect(reticulumInterfaceChangeRequiresStackRestart(undefined, { port: 4242 })).toBe(true);
    expect(
      reticulumInterfaceChangeRequiresStackRestart(undefined, { command: 'rnsd --pipe' }),
    ).toBe(true);
    expect(reticulumInterfaceChangeRequiresStackRestart(undefined, { mode: 'boundary' })).toBe(
      true,
    );
    expect(reticulumInterfaceChangeRequiresStackRestart(undefined, { name: 'new' })).toBe(false);
  });
});
