import { describe, expect, it } from 'vitest';

import {
  normalizeReticulumPickerScanError,
  reticulumPickerScanErrorI18nKey,
} from './reticulumPickerScanError';

describe('reticulumPickerScanError', () => {
  it('normalizes rns-ble missing feature to stable code', () => {
    expect(normalizeReticulumPickerScanError('rns-ble feature not enabled in this build')).toBe(
      'ble_feature_disabled',
    );
  });

  it('maps scan_failed to pickerScanFailed', () => {
    expect(reticulumPickerScanErrorI18nKey('scan_failed')).toEqual({
      key: 'connectionPanel.reticulumInterfaces.pickerScanFailed',
    });
  });

  it('maps ble_feature_disabled to dedicated key', () => {
    expect(reticulumPickerScanErrorI18nKey('ble_feature_disabled')).toEqual({
      key: 'connectionPanel.reticulumInterfaces.pickerBleFeatureDisabled',
    });
  });

  it('wraps unknown errors with detail param', () => {
    expect(reticulumPickerScanErrorI18nKey('adapter timeout')).toEqual({
      key: 'connectionPanel.reticulumInterfaces.pickerScanFailedDetail',
      params: { detail: 'adapter timeout' },
    });
  });
});
