import { describe, expect, it } from 'vitest';

import {
  formatMeshtasticBluetoothPin,
  parseMeshtasticBluetoothPin,
  sanitizeMeshtasticBluetoothPinInput,
} from './meshtasticBluetoothPin';

describe('formatMeshtasticBluetoothPin', () => {
  it('zero-pads numeric fixedPin values for display', () => {
    expect(formatMeshtasticBluetoothPin(12345)).toBe('012345');
    expect(formatMeshtasticBluetoothPin(123456)).toBe('123456');
    expect(formatMeshtasticBluetoothPin(1234)).toBe('001234');
    expect(formatMeshtasticBluetoothPin(0)).toBe('000000');
  });
});

describe('parseMeshtasticBluetoothPin', () => {
  it('accepts exactly six digits including leading zeros', () => {
    expect(parseMeshtasticBluetoothPin('012345')).toBe(12345);
    expect(parseMeshtasticBluetoothPin('123456')).toBe(123456);
  });

  it('rejects incomplete or non-digit input', () => {
    expect(parseMeshtasticBluetoothPin('12345')).toBeNull();
    expect(parseMeshtasticBluetoothPin('0123456')).toBeNull();
    expect(parseMeshtasticBluetoothPin('01234a')).toBeNull();
    expect(parseMeshtasticBluetoothPin('')).toBeNull();
  });
});

describe('sanitizeMeshtasticBluetoothPinInput', () => {
  it('strips non-digits and caps length at six', () => {
    expect(sanitizeMeshtasticBluetoothPinInput('01a2345')).toBe('012345');
    expect(sanitizeMeshtasticBluetoothPinInput('1234567890')).toBe('123456');
  });
});
