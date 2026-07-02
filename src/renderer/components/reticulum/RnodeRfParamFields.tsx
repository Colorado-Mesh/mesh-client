import { useTranslation } from 'react-i18next';

export function hzToMhzFieldValue(hz: number | null | undefined): string {
  if (hz == null) return '';
  return String(hz / 1_000_000);
}

export function parseMhzFieldToHz(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const mhz = Number.parseFloat(trimmed);
  if (!Number.isFinite(mhz) || mhz <= 0) return null;
  return Math.round(mhz * 1_000_000);
}

export function hzToKhzFieldValue(hz: number | null | undefined): string {
  if (hz == null) return '';
  return String(hz / 1_000);
}

export function parseKhzFieldToHz(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const khz = Number.parseFloat(trimmed);
  if (!Number.isFinite(khz) || khz <= 0) return null;
  return Math.round(khz * 1_000);
}

export interface RnodeRfFieldValues {
  frequencyMhz: string;
  bandwidthKhz: string;
  spreadingFactor: string;
  codingRate: string;
  txpower: string;
}

export function RnodeRfParamFields({
  values,
  onChange,
  disabled,
  idPrefix,
}: {
  values: RnodeRfFieldValues;
  onChange: (patch: Partial<RnodeRfFieldValues>) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const { t } = useTranslation();
  const inputClass =
    'mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-50';
  return (
    <>
      <label className="text-xs text-gray-400" htmlFor={`${idPrefix}-frequency`}>
        {t('connectionPanel.reticulumInterfaces.rfFrequencyMhz')}
        <input
          id={`${idPrefix}-frequency`}
          type="number"
          step="0.001"
          min="0"
          value={values.frequencyMhz}
          disabled={disabled}
          onChange={(e) => {
            onChange({ frequencyMhz: e.target.value });
          }}
          className={`${inputClass} w-28`}
        />
      </label>
      <label className="text-xs text-gray-400" htmlFor={`${idPrefix}-bandwidth`}>
        {t('connectionPanel.reticulumInterfaces.rfBandwidthKhz')}
        <input
          id={`${idPrefix}-bandwidth`}
          type="number"
          step="1"
          min="0"
          value={values.bandwidthKhz}
          disabled={disabled}
          onChange={(e) => {
            onChange({ bandwidthKhz: e.target.value });
          }}
          className={`${inputClass} w-24`}
        />
      </label>
      <label className="text-xs text-gray-400" htmlFor={`${idPrefix}-sf`}>
        {t('connectionPanel.reticulumInterfaces.rfSpreadingFactor')}
        <input
          id={`${idPrefix}-sf`}
          type="number"
          step="1"
          min="5"
          max="12"
          value={values.spreadingFactor}
          disabled={disabled}
          onChange={(e) => {
            onChange({ spreadingFactor: e.target.value });
          }}
          className={`${inputClass} w-16`}
        />
      </label>
      <label className="text-xs text-gray-400" htmlFor={`${idPrefix}-cr`}>
        {t('connectionPanel.reticulumInterfaces.rfCodingRate')}
        <input
          id={`${idPrefix}-cr`}
          type="number"
          step="1"
          min="4"
          max="8"
          value={values.codingRate}
          disabled={disabled}
          onChange={(e) => {
            onChange({ codingRate: e.target.value });
          }}
          className={`${inputClass} w-16`}
        />
      </label>
      <label className="text-xs text-gray-400" htmlFor={`${idPrefix}-txpower`}>
        {t('connectionPanel.reticulumInterfaces.rfTxPower')}
        <input
          id={`${idPrefix}-txpower`}
          type="number"
          step="1"
          min="1"
          max="30"
          value={values.txpower}
          disabled={disabled}
          onChange={(e) => {
            onChange({ txpower: e.target.value });
          }}
          className={`${inputClass} w-16`}
        />
      </label>
    </>
  );
}
