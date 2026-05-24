import { describe, expect, it } from 'vitest';

import {
  formatChannelPskInput,
  parseChannelPskInput,
  parseManualChannelPublishEntries,
  parseManualChannelPublishEntry,
  validateChannelPskEntries,
} from './meshtasticChannelPskInput';

const KEY_A = '1PG7OiApB1nwvP+rz05pAQ==';
const KEY_B = 'AAAAAAAAAAAAAAAAAAAAAA==';
/** 32-byte AES-256 test key. */
const KEY_AES256 = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';

describe('parseChannelPskInput', () => {
  it('parses a single bare base64 key', () => {
    expect(parseChannelPskInput(KEY_A)).toEqual([KEY_A]);
  });

  it('parses multiple keys separated by newlines', () => {
    expect(parseChannelPskInput(`${KEY_A}\n${KEY_B}`)).toEqual([KEY_A, KEY_B]);
  });

  it('parses multiple keys separated by commas', () => {
    expect(parseChannelPskInput(`${KEY_A}, ${KEY_B}`)).toEqual([KEY_A, KEY_B]);
  });

  it('parses ChannelName=base64 entries', () => {
    expect(parseChannelPskInput(`HamNet=${KEY_B}`)).toEqual([`HamNet=${KEY_B}`]);
  });

  it('parses ChannelName@index=base64 entries', () => {
    expect(parseChannelPskInput(`HamNet@2=${KEY_B}`)).toEqual([`HamNet@2=${KEY_B}`]);
  });

  it('trims whitespace and drops empty segments', () => {
    expect(parseChannelPskInput(`  ${KEY_A}  ,  , \n  ${KEY_B}  `)).toEqual([KEY_A, KEY_B]);
  });
});

describe('formatChannelPskInput', () => {
  it('joins entries with newlines', () => {
    expect(formatChannelPskInput([KEY_A, KEY_B])).toBe(`${KEY_A}\n${KEY_B}`);
  });

  it('returns empty string for undefined', () => {
    expect(formatChannelPskInput(undefined)).toBe('');
  });
});

describe('validateChannelPskEntries', () => {
  it('accepts valid AES-128 and AES-256 keys', () => {
    expect(validateChannelPskEntries([KEY_A, KEY_AES256])).toBe('ok');
  });

  it('accepts ChannelName=base64 form', () => {
    expect(validateChannelPskEntries([`HamNet=${KEY_B}`])).toBe('ok');
  });

  it('accepts ChannelName@index=base64 form', () => {
    expect(validateChannelPskEntries([`HamNet@2=${KEY_B}`])).toBe('ok');
  });

  it('rejects invalid base64', () => {
    expect(validateChannelPskEntries(['not!!!base64'])).toBe('invalidBase64');
  });

  it('rejects invalid decoded length', () => {
    const twentyBytes = btoa(String.fromCharCode(...new Uint8Array(20).fill(2)));
    expect(validateChannelPskEntries([twentyBytes])).toBe('invalidLength');
  });

  it('returns ok for empty list', () => {
    expect(validateChannelPskEntries([])).toBe('ok');
  });
});

describe('parseManualChannelPublishEntry', () => {
  it('parses ChannelName@index=base64 with index and psk', () => {
    const entry = parseManualChannelPublishEntry(`HamNet@2=${KEY_B}`);
    expect(entry).toEqual({
      name: 'HamNet',
      index: 2,
      psk: Uint8Array.from(atob(KEY_B), (c) => c.charCodeAt(0)),
    });
  });

  it('parses ChannelName=base64 without index', () => {
    const entry = parseManualChannelPublishEntry(`LongFast=${KEY_AES256}`);
    expect(entry?.name).toBe('LongFast');
    expect(entry?.index).toBeUndefined();
    expect(entry?.psk.length).toBe(32);
  });

  it('returns null for bare base64 (decrypt-only)', () => {
    expect(parseManualChannelPublishEntry(KEY_A)).toBeNull();
  });

  it('returns null for invalid named lines', () => {
    expect(parseManualChannelPublishEntry('BadName=not!!!base64')).toBeNull();
  });
});

describe('parseManualChannelPublishEntries', () => {
  it('collects only valid named entries', () => {
    const entries = parseManualChannelPublishEntries([
      `HamNet=${KEY_B}`,
      KEY_A,
      `LongFast@0=${KEY_AES256}`,
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.name).toBe('HamNet');
    expect(entries[1]?.index).toBe(0);
  });
});
