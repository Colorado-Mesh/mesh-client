import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { defaultPickerSort, nextPickerSort, sortPickerItems } from '@/renderer/lib/pickerListSort';
import { getSerialPortNodeName, loadLastSerialPortId } from '@/renderer/lib/serialPortNodeNames';
import type { SerialPortInfo } from '@/renderer/lib/types';

import { PickerSortControls } from '../PickerSortControls';

export interface FlasherSerialPortPickerProps {
  ports: SerialPortInfo[];
  onSelect: (portId: string) => void;
  onCancel: () => void;
}

export function FlasherSerialPortPicker({
  ports,
  onSelect,
  onCancel,
}: FlasherSerialPortPickerProps) {
  const { t } = useTranslation();
  const lastUsedPortId = loadLastSerialPortId();
  const [sortPref, setSortPref] = useState(() => defaultPickerSort('serial'));
  const getName = useCallback(
    (port: SerialPortInfo) => getSerialPortNodeName(port.portId) ?? port.displayName,
    [],
  );
  const getId = useCallback((port: SerialPortInfo) => port.portId, []);
  const sortedPorts = useMemo(
    () =>
      sortPickerItems(ports, sortPref.key, sortPref.dir, {
        getName,
        getId,
      }),
    [getId, getName, ports, sortPref.dir, sortPref.key],
  );

  return (
    <div
      role="region"
      aria-labelledby="flasher-serial-picker-heading"
      className="bg-deep-black w-full overflow-hidden rounded-lg border border-gray-600"
    >
      <div className="bg-secondary-dark flex items-center justify-between gap-2 border-b border-gray-600 px-4 py-2.5">
        <span id="flasher-serial-picker-heading" className="text-sm font-medium text-gray-200">
          {t('flasher.selectSerialPort')}
        </span>
        <div className="flex items-center gap-2">
          {ports.length > 0 ? (
            <PickerSortControls
              mode="serial"
              sortKey={sortPref.key}
              sortDir={sortPref.dir}
              onSortClick={(key) => {
                setSortPref((prev) => nextPickerSort(prev, key));
              }}
            />
          ) : null}
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
      <div className="max-h-60 overflow-y-auto">
        {ports.length === 0 ? (
          <div className="text-muted px-4 py-6 text-center text-sm">
            <p>{t('flasher.noSerialPorts')}</p>
            <p className="mt-2 text-xs">{t('flasher.noSerialPortsHint')}</p>
          </div>
        ) : (
          sortedPorts.map((port) => {
            const cachedNodeName = getSerialPortNodeName(port.portId);
            const isLastUsed = lastUsedPortId != null && port.portId === lastUsedPortId;
            const details = `${port.portName}${port.vendorId ? ` (VID: ${port.vendorId})` : ''}${port.productId ? ` PID: ${port.productId}` : ''}`;
            const title = cachedNodeName ?? port.displayName;
            return (
              <button
                key={port.portId}
                type="button"
                aria-label={`${title} ${details}${isLastUsed ? ` ${t('flasher.lastUsedPort')}` : ''}`}
                onClick={() => {
                  onSelect(port.portId);
                }}
                className={`hover:bg-secondary-dark w-full border-b border-gray-700 px-4 py-3 text-left transition-colors last:border-b-0${isLastUsed ? 'border-l-readable-green bg-secondary-dark/40 border-l-2' : ''}`}
              >
                <div className="flex items-center gap-2 text-sm text-gray-200">
                  <span>{title}</span>
                  {isLastUsed ? (
                    <span className="bg-readable-green/20 text-readable-green rounded px-1.5 py-0.5 text-[10px] font-medium">
                      {t('flasher.lastUsedPort')}
                    </span>
                  ) : null}
                </div>
                <div className="text-muted font-mono text-xs">{details}</div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
