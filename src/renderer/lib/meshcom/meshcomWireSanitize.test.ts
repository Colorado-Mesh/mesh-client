import { describe, expect, it } from 'vitest';

import { encodeMeshcomBleCommand } from './meshcomBleFrame';
import { normalizeMeshcomCommandInput } from './meshcomCommandWire';
import { encodeMeshcomSerialLine, meshcomSerialSendText } from './meshcomSerial';
import { sanitizeMeshcomWireLine } from './meshcomWireSanitize';

describe('meshcomWireSanitize', () => {
  it('strips CR/LF from serial chat inject', () => {
    const bytes = meshcomSerialSendText('*', 'hi\r\n--reboot');
    const line = new TextDecoder().decode(bytes);
    expect(line).toBe('hi--reboot\r\n');
    expect(line).not.toContain('\r\n--reboot');
  });

  it('strips CR/LF from device command lines', () => {
    const poisoned = normalizeMeshcomCommandInput('--volt on\r\n--reboot now');
    expect(poisoned).not.toMatch(/\r|\n/);
    const serial = encodeMeshcomSerialLine(poisoned);
    expect(new TextDecoder().decode(serial)).toBe('--volt on--reboot now\r\n');
  });

  it('strips control chars from BLE command encode', () => {
    const frame = encodeMeshcomBleCommand(sanitizeMeshcomWireLine('--info\r\n--reboot'));
    const body = new TextDecoder().decode(frame.subarray(2));
    expect(body).toBe('--info--reboot');
  });
});
