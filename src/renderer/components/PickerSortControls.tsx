import { useTranslation } from 'react-i18next';

import {
  defaultPickerSortDir,
  type PickerSortDir,
  type PickerSortKey,
  type PickerSortMode,
} from '../lib/pickerListSort';

export interface PickerSortControlsProps {
  mode: PickerSortMode;
  sortKey: PickerSortKey;
  sortDir: PickerSortDir;
  onSortClick: (key: PickerSortKey) => void;
}

function pickerSortAriaKey(key: PickerSortKey, dir: PickerSortDir): string {
  if (key === 'rssi') {
    return dir === 'asc' ? 'connectionPanel.sortByRssiAsc' : 'connectionPanel.sortByRssiDesc';
  }
  return dir === 'asc' ? 'connectionPanel.sortByNameAsc' : 'connectionPanel.sortByNameDesc';
}

function pickerSortLabelKey(key: PickerSortKey): string {
  return key === 'rssi' ? 'connectionPanel.sortRssi' : 'connectionPanel.sortName';
}

function sortDirGlyph(dir: PickerSortDir): string {
  return dir === 'asc' ? ' ▲' : ' ▼';
}

export function PickerSortControls({
  mode,
  sortKey,
  sortDir,
  onSortClick,
}: PickerSortControlsProps) {
  const { t } = useTranslation();
  const keys: readonly PickerSortKey[] = mode === 'ble' ? ['name', 'rssi'] : ['name'];

  return (
    <div
      role="toolbar"
      aria-label={t('connectionPanel.sortToolbar')}
      className="flex items-center gap-1 text-xs"
    >
      {keys.map((key) => {
        const active = sortKey === key;
        const dirForAria = active ? sortDir : defaultPickerSortDir(key);
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            aria-label={t(pickerSortAriaKey(key, dirForAria))}
            className={`rounded px-2 py-0.5 transition-colors ${
              active ? 'bg-slate-700 text-gray-100' : 'text-muted hover:text-gray-200'
            }`}
            onClick={() => {
              onSortClick(key);
            }}
          >
            {t(pickerSortLabelKey(key))}
            {active ? sortDirGlyph(sortDir) : ''}
          </button>
        );
      })}
    </div>
  );
}
