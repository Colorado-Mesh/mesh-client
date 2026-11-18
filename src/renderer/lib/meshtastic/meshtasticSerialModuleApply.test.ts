import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { validateMeshtasticSerialModuleApply } from './meshtasticSerialModuleApply';

const t = ((key: string) => key) as TFunction;

describe('validateMeshtasticSerialModuleApply', () => {
  it('allows disabled module regardless of override settings', () => {
    expect(
      validateMeshtasticSerialModuleApply(
        { enabled: false, overrideConsoleSerialPort: true, mode: 0 },
        t,
      ),
    ).toBeNull();
  });

  it('allows enabled module without console override', () => {
    expect(
      validateMeshtasticSerialModuleApply(
        { enabled: true, overrideConsoleSerialPort: false, mode: 0 },
        t,
      ),
    ).toBeNull();
  });

  it('rejects override when mode is unset', () => {
    expect(
      validateMeshtasticSerialModuleApply(
        { enabled: true, overrideConsoleSerialPort: true, mode: 0 },
        t,
      ),
    ).toBe('modulePanel.errors.serialOverrideRequiresMode');
  });

  it('rejects override with TEXTMSG mode', () => {
    expect(
      validateMeshtasticSerialModuleApply(
        { enabled: true, overrideConsoleSerialPort: true, mode: 3 },
        t,
      ),
    ).toBe('modulePanel.errors.serialOverrideRequiresMode');
  });

  it('rejects override with LOG mode', () => {
    expect(
      validateMeshtasticSerialModuleApply(
        { enabled: true, overrideConsoleSerialPort: true, mode: 9 },
        t,
      ),
    ).toBe('modulePanel.errors.serialOverrideRequiresMode');
  });

  it.each([4, 5, 8])('allows override with firmware-supported mode %i', (mode) => {
    expect(
      validateMeshtasticSerialModuleApply(
        { enabled: true, overrideConsoleSerialPort: true, mode },
        t,
      ),
    ).toBeNull();
  });
});
