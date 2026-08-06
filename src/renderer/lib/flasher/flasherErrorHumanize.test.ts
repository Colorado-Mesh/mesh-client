import { describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/lib/i18n', () => ({
  default: {
    t: (key: string) => {
      const messages: Record<string, string> = {
        'flasher.errors.esp32SyncFailed':
          'Could not sync with the ESP32 bootloader. Unplug other serial apps, pick the correct USB port, then retry.',
        'flasher.errors.portSelectionTimedOut':
          'Serial port selection timed out. Pick a port from the list within two minutes, or retry flash to reuse the last port.',
        'flasher.errors.portSelectionCancelled': 'Serial port selection was cancelled.',
        'flasher.errors.rnodeCommandTimeout': 'Device stopped responding over serial.',
        'flasher.errors.esp32FlashStalled': 'Firmware transfer stalled with no progress.',
        'flasher.errors.provisionWipeRequired': 'EEPROM is locked with an invalid identity.',
        'flasher.errors.provisionVerifyFailed': 'device still reports an unprovisioned EEPROM',
        'flasher.errors.generic': 'Operation failed: {{message}}',
        'flasher.errors.unknown': 'An unexpected error occurred.',
      };
      return messages[key] ?? key;
    },
  },
}));

import { humanizeFlasherError } from './flasherErrorHumanize';

describe('humanizeFlasherError', () => {
  it('maps ESP32 sync failures distinctly from serial port picker errors', () => {
    expect(humanizeFlasherError(new Error('ESP32_SYNC_FAILED'))).toContain('ESP32 bootloader');
    expect(humanizeFlasherError(new Error('FLASHER_SERIAL_PORT_SELECTION_TIMEOUT'))).toContain(
      'Serial port selection timed out',
    );
    expect(humanizeFlasherError(new Error('FLASHER_SERIAL_PORT_SELECTION_CANCELLED'))).toContain(
      'Serial port selection was cancelled',
    );
  });

  it('maps flasher hang timeout errors', () => {
    expect(humanizeFlasherError(new Error('RNODE_COMMAND_TIMEOUT'))).toContain(
      'stopped responding',
    );
    expect(humanizeFlasherError(new Error('ESP32_FLASH_STALLED'))).toContain('stalled');
    expect(humanizeFlasherError(new Error('NRF52_DFU_STALLED'))).toContain('stalled');
  });

  it('uses unknown fallback for unrecognized errors', () => {
    expect(humanizeFlasherError(new Error('SOME_GARBAGE_WIRE_TEXT'))).toContain('Operation failed');
  });

  it('maps provision verify and wipe-required errors', () => {
    expect(humanizeFlasherError(new Error('PROVISION_WIPE_REQUIRED'))).toContain(
      'locked with an invalid identity',
    );
    expect(humanizeFlasherError(new Error('PROVISION_VERIFY_FAILED'))).toContain(
      'unprovisioned EEPROM',
    );
  });
});
