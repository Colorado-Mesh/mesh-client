import { describe, expect, it } from 'vitest';

import { reticulumInterfaceChangeRequiresStackRestart } from './reticulumInterfaceStackRestart';

describe('reticulumInterfaceChangeRequiresStackRestart', () => {
  it('requires restart for local interface types', () => {
    expect(reticulumInterfaceChangeRequiresStackRestart('rnode')).toBe(true);
    expect(reticulumInterfaceChangeRequiresStackRestart('ble_peer')).toBe(true);
    expect(reticulumInterfaceChangeRequiresStackRestart('tcp')).toBe(false);
  });

  it('requires restart when serial or radio fields change', () => {
    expect(
      reticulumInterfaceChangeRequiresStackRestart(undefined, { serial_port: 'ble://aa' }),
    ).toBe(true);
    expect(reticulumInterfaceChangeRequiresStackRestart(undefined, { name: 'new' })).toBe(false);
  });
});
