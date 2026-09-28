import { useTranslation } from 'react-i18next';

import { INPUT_BOX_CLASS } from '../ui/formClasses';

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
  return (
    <>
      <label className="text-ink-400 text-xs" htmlFor={`${idPrefix}-frequency`}>
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
          className={`${INPUT_BOX_CLASS} mt-1 block w-28`}
        />
      </label>
      <label className="text-ink-400 text-xs" htmlFor={`${idPrefix}-bandwidth`}>
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
          className={`${INPUT_BOX_CLASS} mt-1 block w-24`}
        />
      </label>
      <label className="text-ink-400 text-xs" htmlFor={`${idPrefix}-sf`}>
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
          className={`${INPUT_BOX_CLASS} mt-1 block w-16`}
        />
      </label>
      <label className="text-ink-400 text-xs" htmlFor={`${idPrefix}-cr`}>
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
          className={`${INPUT_BOX_CLASS} mt-1 block w-16`}
        />
      </label>
      <label className="text-ink-400 text-xs" htmlFor={`${idPrefix}-txpower`}>
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
          className={`${INPUT_BOX_CLASS} mt-1 block w-16`}
        />
      </label>
    </>
  );
}
