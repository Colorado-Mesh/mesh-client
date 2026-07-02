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
});
