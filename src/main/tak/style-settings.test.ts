import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let userDataDir = '';

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
}));

import { DEFAULT_TAK_STYLE_SETTINGS, type TakStyleSettings } from '../../shared/tak-types';
import {
  loadTakStyleSettings,
  parseTakStyleSettings,
  saveTakStyleSettings,
} from './style-settings';

const VALID: TakStyleSettings = {
  sendUnmatched: false,
  filters: [
    {
      enabled: true,
      op: 'startsWith',
      patterns: [' EMS ', ''],
      stripMatch: true,
      style: { cotType: 'a-f-G-U-S-M', group: 'White', role: 'Medic', color: '#FF8800' },
    },
  ],
};

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-tak-style-'));
});

afterEach(() => {
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('parseTakStyleSettings', () => {
  it('keeps known fields and trims empty patterns', () => {
    const parsed = parseTakStyleSettings({ ...VALID, extra: 1 });
    expect(parsed.filters[0].patterns).toEqual(['EMS']);
    expect(parsed).not.toHaveProperty('extra');
  });

  it.each([
    ['not an object', null],
    ['missing sendUnmatched', { filters: [] }],
    ['too many filters', { sendUnmatched: true, filters: Array(9).fill(VALID.filters[0]) }],
    ['unknown op', { ...VALID, filters: [{ ...VALID.filters[0], op: 'regex' }] }],
    ['a bad CoT type', { ...VALID, filters: [{ ...VALID.filters[0], style: { cotType: '<x>' } }] }],
    [
      'a non-ATAK team color',
      { ...VALID, filters: [{ ...VALID.filters[0], style: { cotType: 'a-f-G', group: 'Pink' } }] },
    ],
    [
      'a non-ATAK role',
      { ...VALID, filters: [{ ...VALID.filters[0], style: { cotType: 'a-f-G', role: 'Boss' } }] },
    ],
    [
      'a bad color',
      { ...VALID, filters: [{ ...VALID.filters[0], style: { cotType: 'a-f-G', color: 'red' } }] },
    ],
    [
      'an overlong pattern',
      { ...VALID, filters: [{ ...VALID.filters[0], patterns: ['x'.repeat(65)] }] },
    ],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseTakStyleSettings(raw)).toThrow(/tak:setStyleSettings/);
  });
});

describe('load/save TAK style settings', () => {
  it('returns the defaults when nothing was saved', () => {
    expect(loadTakStyleSettings()).toEqual(DEFAULT_TAK_STYLE_SETTINGS);
  });

  it('round-trips saved settings without leaving a temp file', () => {
    const parsed = parseTakStyleSettings(VALID);
    saveTakStyleSettings(parsed);
    expect(loadTakStyleSettings()).toEqual(parsed);
    expect(fs.readdirSync(userDataDir)).toEqual(['tak-style-settings.json']);
  });

  it('falls back to the defaults when the saved file is corrupt', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fs.writeFileSync(path.join(userDataDir, 'tak-style-settings.json'), '{not json');
    expect(loadTakStyleSettings()).toEqual(DEFAULT_TAK_STYLE_SETTINGS);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
