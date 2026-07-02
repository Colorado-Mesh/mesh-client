export type ReticulumPickerScanErrorCode =
  'stack_required' | 'scan_busy' | 'ble_unavailable' | 'ble_feature_disabled' | 'scan_failed';

const BLE_FEATURE_DISABLED_EN = 'rns-ble feature not enabled in this build';

export function normalizeReticulumPickerScanError(raw: string): string {
  if (raw === BLE_FEATURE_DISABLED_EN || raw.includes('rns-ble feature not enabled')) {
    return 'ble_feature_disabled';
  }
  return raw;
}

export function reticulumPickerScanErrorI18nKey(scanError: string): {
  key: string;
  params?: Record<string, string>;
} {
  if (scanError === 'stack_required') {
    return { key: 'connectionPanel.reticulumInterfaces.pickerStackRequired' };
  }
  if (scanError === 'scan_busy') {
    return { key: 'connectionPanel.humanize.ble.scanBusy' };
  }
  if (scanError === 'ble_unavailable') {
    return { key: 'connectionPanel.reticulumInterfaces.bleUnavailable' };
  }
  if (scanError === 'ble_feature_disabled') {
    return { key: 'connectionPanel.reticulumInterfaces.pickerBleFeatureDisabled' };
  }
  if (scanError === 'scan_failed') {
    return { key: 'connectionPanel.reticulumInterfaces.pickerScanFailed' };
  }
  if (
    scanError === 'pickerStackRequired' ||
    scanError.startsWith('connectionPanel.') ||
    scanError.startsWith('diagnosticsPanel.')
  ) {
    return { key: scanError };
  }
  return {
    key: 'connectionPanel.reticulumInterfaces.pickerScanFailedDetail',
    params: { detail: scanError },
  };
}
