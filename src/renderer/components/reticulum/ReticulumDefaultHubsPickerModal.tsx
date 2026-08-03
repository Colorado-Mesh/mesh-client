import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  defaultSelectedDefaultHubPresetIds,
  findInterfaceForHubPresetEndpoint,
  formatDefaultHubPresetEndpoint,
  presetsForDefaultHubRegion,
  RETICULUM_DEFAULT_HUB_PRESETS,
  RETICULUM_DEFAULT_HUB_REGIONS,
  type ReticulumDefaultHubRegion,
} from '@/renderer/lib/reticulum/reticulumDefaultHubPresets';
import type { ReticulumInterfaceRow } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ReticulumDefaultHubsPickerModalProps {
  interfaces: readonly ReticulumInterfaceRow[];
  confirming: boolean;
  onCancel: () => void;
  onConfirm: (presetIds: ReadonlySet<string>) => void;
}

function regionLabelKey(region: ReticulumDefaultHubRegion): string {
  return `connectionPanel.reticulumInterfaces.defaultHubRegion.${region}`;
}

export function ReticulumDefaultHubsPickerModal({
  interfaces,
  confirming,
  onCancel,
  onConfirm,
}: ReticulumDefaultHubsPickerModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const hintId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const alreadyPresentIds = useMemo(() => {
    const present = new Set<string>();
    for (const preset of RETICULUM_DEFAULT_HUB_PRESETS) {
      if (findInterfaceForHubPresetEndpoint(interfaces, preset)) {
        present.add(preset.id);
      }
    }
    return present;
  }, [interfaces]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    const initial = defaultSelectedDefaultHubPresetIds();
    for (const id of alreadyPresentIds) {
      initial.add(id);
    }
    return initial;
  });

  const actionableSelectedCount = useMemo(() => {
    let count = 0;
    for (const id of selectedIds) {
      if (!alreadyPresentIds.has(id)) count += 1;
    }
    return count;
  }, [selectedIds, alreadyPresentIds]);

  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  // Focus once on mount only. Do not depend on onCancel — parent passes an inline
  // callback that changes every render; re-focusing the first control snaps scroll to top.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = () =>
      [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancelRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const nodes = focusables();
      if (nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const prev = previouslyFocusedRef.current;
      if (prev && document.contains(prev)) {
        prev.focus();
      }
    };
  }, []);

  const togglePreset = (presetId: string, checked: boolean) => {
    if (alreadyPresentIds.has(presetId)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(presetId);
      else next.delete(presetId);
      return next;
    });
  };

  const toggleRegion = (region: ReticulumDefaultHubRegion, checked: boolean) => {
    const regionPresets = presetsForDefaultHubRegion(region);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const preset of regionPresets) {
        if (alreadyPresentIds.has(preset.id)) {
          // Keep already-configured hubs selected so sync can still repair names/modes.
          next.add(preset.id);
          continue;
        }
        if (checked) next.add(preset.id);
        else next.delete(preset.id);
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label={t('common.cancel')}
        className="absolute inset-0 cursor-pointer border-0 bg-black/60 p-0 backdrop-blur-sm"
        onClick={onCancel}
        disabled={confirming}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        className="bg-deep-black relative mx-4 flex max-h-[min(85vh,640px)] w-full max-w-lg flex-col rounded-xl border border-gray-600 shadow-2xl"
      >
        <div className="space-y-2 border-b border-gray-700 px-5 py-4">
          <h3 id={titleId} className="text-lg font-semibold text-gray-200">
            {t('connectionPanel.reticulumInterfaces.defaultHubsPickerTitle')}
          </h3>
          <p id={hintId} className="text-muted text-sm leading-relaxed">
            {t('connectionPanel.reticulumInterfaces.defaultHubsPickerHint')}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {RETICULUM_DEFAULT_HUB_REGIONS.map((region) => (
            <RegionSection
              key={region}
              region={region}
              selectedIds={selectedIds}
              alreadyPresentIds={alreadyPresentIds}
              onToggleRegion={toggleRegion}
              onTogglePreset={togglePreset}
            />
          ))}
        </div>

        <div className="flex gap-3 border-t border-gray-700 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={confirming}
            className="bg-secondary-dark flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600 disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm(selectedIds);
            }}
            disabled={confirming || selectedIds.size === 0}
            className="bg-readable-green flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-600 disabled:opacity-50"
            aria-label={t('connectionPanel.reticulumInterfaces.defaultHubsPickerConfirmAria', {
              count: actionableSelectedCount,
            })}
          >
            {confirming
              ? t('common.loading')
              : actionableSelectedCount > 0
                ? t('connectionPanel.reticulumInterfaces.defaultHubsPickerConfirm', {
                    count: actionableSelectedCount,
                  })
                : t('connectionPanel.reticulumInterfaces.defaultHubsPickerConfirmSync')}
          </button>
        </div>
      </div>
    </div>
  );
}

function RegionSection({
  region,
  selectedIds,
  alreadyPresentIds,
  onToggleRegion,
  onTogglePreset,
}: {
  region: ReticulumDefaultHubRegion;
  selectedIds: ReadonlySet<string>;
  alreadyPresentIds: ReadonlySet<string>;
  onToggleRegion: (region: ReticulumDefaultHubRegion, checked: boolean) => void;
  onTogglePreset: (presetId: string, checked: boolean) => void;
}) {
  const { t } = useTranslation();
  const presets = presetsForDefaultHubRegion(region);
  const selectedCount = presets.filter((p) => selectedIds.has(p.id)).length;
  const allSelected = selectedCount === presets.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const regionCheckboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (regionCheckboxRef.current) {
      regionCheckboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">{t(regionLabelKey(region))}</legend>
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-200">
        <input
          ref={regionCheckboxRef}
          type="checkbox"
          checked={allSelected}
          onChange={(e) => {
            onToggleRegion(region, e.target.checked);
          }}
          className="accent-brand-green"
          aria-label={t(regionLabelKey(region))}
        />
        <span>{t(regionLabelKey(region))}</span>
      </label>
      <ul className="ml-6 space-y-1.5">
        {presets.map((preset) => {
          const present = alreadyPresentIds.has(preset.id);
          const checked = present || selectedIds.has(preset.id);
          return (
            <li key={preset.id}>
              <label
                className={`flex items-start gap-2 text-sm ${
                  present ? 'cursor-default text-gray-500' : 'cursor-pointer text-gray-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={present}
                  onChange={(e) => {
                    onTogglePreset(preset.id, e.target.checked);
                  }}
                  className="accent-brand-green mt-0.5"
                  aria-label={t('connectionPanel.reticulumInterfaces.defaultHubPresetAria', {
                    name: preset.name,
                    endpoint: formatDefaultHubPresetEndpoint(preset),
                  })}
                />
                <span className="min-w-0">
                  <span className="block truncate">{preset.name}</span>
                  <span className="text-muted block truncate text-xs">
                    {formatDefaultHubPresetEndpoint(preset)}
                    {present
                      ? ` · ${t('connectionPanel.reticulumInterfaces.defaultHubAlreadyAdded')}`
                      : null}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
