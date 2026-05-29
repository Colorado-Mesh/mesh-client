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

  it('requires positive mode when override is enabled on device', () => {
    expect(
      validateMeshtasticSerialModuleApply(
        { enabled: true, overrideConsoleSerialPort: true, mode: 0 },
        t,
      ),
    ).toBe('modulePanel.errors.serialOverrideRequiresMode');
  });

  it('allows enabled module with override when mode is set', () => {
    expect(
      validateMeshtasticSerialModuleApply(
        { enabled: true, overrideConsoleSerialPort: true, mode: 2 },
        t,
      ),
    ).toBeNull();
  });
});
