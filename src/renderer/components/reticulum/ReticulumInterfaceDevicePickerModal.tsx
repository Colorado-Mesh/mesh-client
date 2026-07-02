import { useTranslation } from 'react-i18next';

import type {
  ReticulumDevicePickerMode,
  ReticulumPickerDevice,
} from '@/renderer/hooks/useReticulumInterfaceDevicePicker';
import { ConnectionIcon } from '@/renderer/lib/icons/connectionIcons';
import { SpinnerIcon } from '@/renderer/lib/icons/spinnerIcon';

export interface ReticulumInterfaceDevicePickerModalProps {
  open: boolean;
  mode: ReticulumDevicePickerMode;
  devices: ReticulumPickerDevice[];
  serialPorts: { path: string; label?: string }[];
  scanning: boolean;
  scanError: string | null;
  manualPath: string;
  onManualPathChange: (value: string) => void;
  onSelect: (value: string) => void;
  onCancel: () => void;
  onRefreshSerial: () => void;
  onRescanBle: () => void;
}

function titleKey(mode: ReticulumDevicePickerMode): string {
  if (mode === 'serial') return 'connectionPanel.reticulumInterfaces.pickerSerialTitle';
  if (mode === 'ble-peer') return 'connectionPanel.reticulumInterfaces.pickerBlePeerTitle';
  return 'connectionPanel.reticulumInterfaces.pickerBleRnodeTitle';
}

export function ReticulumInterfaceDevicePickerModal({
  open,
  mode,
  devices,
  serialPorts,
  scanning,
  scanError,
  manualPath,
  onManualPathChange,
  onSelect,
  onCancel,
  onRefreshSerial,
  onRescanBle,
}: ReticulumInterfaceDevicePickerModalProps) {
  const { t } = useTranslation();

  if (!open) return null;

  const isSerial = mode === 'serial';
  const count = isSerial ? serialPorts.length : devices.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t('common.cancel')}
        className="absolute inset-0 cursor-pointer border-0 bg-black/60 p-0"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(titleKey(mode))}
        className="bg-deep-black relative w-full max-w-lg overflow-hidden rounded-lg border border-gray-600 shadow-xl"
      >
        <div className="bg-secondary-dark flex items-center justify-between border-b border-gray-600 px-4 py-2.5">
          <span className="text-sm font-medium text-gray-200">{t(titleKey(mode))}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-300" aria-live="polite">
              {t('connectionPanel.devicesFound', { count })}
            </span>
            {isSerial ? (
              <button
                type="button"
                className="text-xs text-amber-300 hover:text-amber-200"
                aria-label={t('connectionPanel.reticulumInterfaces.refreshPorts')}
                onClick={onRefreshSerial}
              >
                {t('connectionPanel.reticulumInterfaces.refreshPorts')}
              </button>
            ) : (
              <button
                type="button"
                className="text-xs text-amber-300 hover:text-amber-200"
                aria-label={t('connectionPanel.reticulumInterfaces.rescanBle')}
                disabled={scanning}
                onClick={onRescanBle}
              >
                {t('connectionPanel.reticulumInterfaces.rescanBle')}
              </button>
            )}
            <button
              type="button"
              className="text-xs text-gray-400 hover:text-gray-200"
              aria-label={t('common.cancel')}
              onClick={onCancel}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>

        {scanError ? (
          <p className="border-b border-gray-700 px-4 py-2 text-xs text-amber-300" role="alert">
            {scanError === 'stack_required'
              ? t('connectionPanel.reticulumInterfaces.pickerStackRequired')
              : scanError === 'scan_busy'
                ? t('connectionPanel.humanize.ble.scanBusy')
                : scanError === 'ble_unavailable'
                  ? t('connectionPanel.reticulumInterfaces.bleUnavailable')
                  : scanError}
          </p>
        ) : null}

        <div className="max-h-60 overflow-y-auto">
          {isSerial ? (
            serialPorts.length === 0 ? (
              <div className="text-muted px-4 py-4 text-sm">
                <p>{t('connectionPanel.reticulumInterfaces.pickerSerialEmpty')}</p>
                <label className="mt-3 block text-xs text-gray-400">
                  {t('connectionPanel.reticulumInterfaces.serialPort')}
                  <input
                    value={manualPath}
                    onChange={(e) => {
                      onManualPathChange(e.target.value);
                    }}
                    className="mt-1 block w-full rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
                  />
                </label>
                {manualPath.trim() ? (
                  <button
                    type="button"
                    className="mt-3 rounded bg-amber-700 px-3 py-1.5 text-sm text-white hover:bg-amber-600"
                    aria-label={t('connectionPanel.reticulumInterfaces.useManualPort')}
                    onClick={() => {
                      onSelect(manualPath.trim());
                    }}
                  >
                    {t('connectionPanel.reticulumInterfaces.useManualPort')}
                  </button>
                ) : null}
              </div>
            ) : (
              serialPorts.map((port) => (
                <button
                  key={port.path}
                  type="button"
                  aria-label={port.label ?? port.path}
                  onClick={() => {
                    onSelect(port.path);
                  }}
                  className="hover:bg-secondary-dark w-full border-b border-gray-700 px-4 py-3 text-left transition-colors last:border-b-0"
                >
                  <div className="flex items-center gap-2 text-sm text-gray-200">
                    <ConnectionIcon type="serial" />
                    {port.label ?? port.path}
                  </div>
                  <div className="text-muted ml-7 font-mono text-xs">{port.path}</div>
                </button>
              ))
            )
          ) : scanning && devices.length === 0 ? (
            <div className="text-muted px-4 py-6 text-center text-sm">
              <SpinnerIcon className="text-muted mx-auto mb-2 h-5 w-5" />
              {t('connectionPanel.scanningDevices', { protocol: 'Reticulum' })}
            </div>
          ) : devices.length === 0 ? (
            <p className="text-muted px-4 py-6 text-center text-sm">
              {mode === 'ble-peer'
                ? t('connectionPanel.reticulumInterfaces.pickerBlePeerEmpty')
                : mode === 'ble-rnode'
                  ? t('connectionPanel.reticulumInterfaces.pickerBleRnodeEmpty')
                  : t('connectionPanel.reticulumInterfaces.pickerBleEmpty')}
            </p>
          ) : (
            devices.map((device) => {
              const displayName = device.name?.trim() || device.address;
              const value =
                mode === 'ble-rnode'
                  ? `ble://${device.name?.trim() || device.address}`
                  : device.address;
              return (
                <button
                  key={`${device.address}-${device.kind ?? 'ble'}`}
                  type="button"
                  aria-label={`${displayName} ${device.address}`}
                  onClick={() => {
                    onSelect(value);
                  }}
                  className="hover:bg-secondary-dark w-full border-b border-gray-700 px-4 py-3 text-left transition-colors last:border-b-0"
                >
                  <div className="flex items-center gap-2 text-sm text-gray-200">
                    <ConnectionIcon type="ble" />
                    {displayName}
                  </div>
                  <div className="text-muted ml-7 font-mono text-xs">{device.address}</div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
