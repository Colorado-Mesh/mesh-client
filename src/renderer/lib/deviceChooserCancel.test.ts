import { describe, expect, it } from 'vitest';

import { isDeviceChooserCancel } from './deviceChooserCancel';

describe('isDeviceChooserCancel', () => {
  it('recognises a dismissed serial port or Bluetooth chooser, wrapped or not', () => {
    expect(
      isDeviceChooserCancel(
        new Error("Failed to execute 'requestPort' on 'Serial': No port selected by the user."),
      ),
    ).toBe(true);
    expect(
      isDeviceChooserCancel({
        name: 'NotFoundError',
        message: 'User cancelled the requestDevice() chooser.',
      }),
    ).toBe(true);
    expect(isDeviceChooserCancel('No port selected by the user.')).toBe(true);
  });

  it('leaves real connection failures alone', () => {
    expect(isDeviceChooserCancel(new Error('GATT Server is disconnected'))).toBe(false);
    expect(isDeviceChooserCancel(new Error('Failed to open serial port.'))).toBe(false);
    expect(isDeviceChooserCancel(undefined)).toBe(false);
    expect(isDeviceChooserCancel({})).toBe(false);
  });
});
