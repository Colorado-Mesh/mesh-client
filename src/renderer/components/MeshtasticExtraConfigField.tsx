import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { MeshtasticExtraConfigFieldsState } from '@/renderer/hooks/useMeshtasticExtraConfigFields';
import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';
import {
  type ExtraConfigFieldSpec,
  extraFieldOptionLabel,
  toggleFlag,
} from '@/renderer/lib/meshtastic/meshtasticExtraConfigFields';

import { ConfigNumber, ConfigSelect, ConfigText, ConfigToggle } from './moduleConfigControls';

export function MeshtasticExtraConfigField({
  spec,
  state,
  disabled,
  anchorId,
}: {
  spec: ExtraConfigFieldSpec;
  state: MeshtasticExtraConfigFieldsState;
  disabled: boolean;
  anchorId?: string;
}) {
  const { t } = useTranslation();
  const legendId = useId();
  const label = t(spec.labelKey);
  const description = spec.descKey ? t(spec.descKey) : undefined;
  const value = state.values[spec.key];
  const invalid = !state.result.ok && state.result.invalidKey === spec.key;
  const set = (v: boolean | number | string) => {
    state.setValue(spec.key, v);
  };

  let control: React.ReactNode;
  switch (spec.kind) {
    case 'bool':
      control = (
        <ConfigToggle
          anchorId={anchorId}
          label={label}
          checked={value === true}
          onChange={set}
          disabled={disabled}
          description={description}
        />
      );
      break;
    case 'number':
      control = (
        <ConfigNumber
          anchorId={anchorId}
          label={label}
          value={typeof value === 'number' ? value : 0}
          onChange={set}
          disabled={disabled}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          unit={spec.unitKey ? t(spec.unitKey) : undefined}
          description={description}
        />
      );
      break;
    case 'enum': {
      const current = typeof value === 'number' ? value : 0;
      const options = (spec.options ?? []).map((o) => ({
        value: o.value,
        label: extraFieldOptionLabel(o, t),
      }));
      if (!options.some((o) => o.value === current)) {
        options.unshift({
          value: current,
          label: t('radioPanel.unknownEnumValue', { value: current }),
        });
      }
      control = (
        <ConfigSelect
          anchorId={anchorId}
          label={label}
          value={current}
          options={options}
          onChange={set}
          disabled={disabled}
          description={description}
        />
      );
      break;
    }
    case 'flags': {
      const mask = typeof value === 'number' ? value : 0;
      control = (
        <fieldset data-setting-anchor={anchorId} aria-labelledby={legendId} className="space-y-1">
          <legend id={legendId} className="text-muted text-sm">
            {label}
          </legend>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {(spec.options ?? []).map((o) => {
              const optionLabel = extraFieldOptionLabel(o, t);
              return (
                <label key={o.value} className="text-ink-300 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(mask & o.value) !== 0}
                    onChange={(e) => {
                      set(toggleFlag(mask, o.value, e.target.checked));
                    }}
                    disabled={disabled}
                    aria-label={optionLabel}
                  />
                  {optionLabel}
                </label>
              );
            })}
          </div>
          {description && <p className="text-muted text-xs">{description}</p>}
        </fieldset>
      );
      break;
    }
    default:
      control = (
        <ConfigText
          anchorId={anchorId}
          label={label}
          value={typeof value === 'string' ? value : ''}
          onChange={set}
          disabled={disabled}
          maxLength={spec.maxLength}
          description={description}
        />
      );
  }

  return (
    <div className="space-y-1">
      {control}
      {invalid && (
        <p role="alert" className="text-xs text-red-400">
          {t('meshtasticExtraConfig.invalidValue', { field: label })}
        </p>
      )}
    </div>
  );
}

/** Collapsible group for board-pin / I2C overrides most users never touch. */
export function MeshtasticAdvancedHardwareGroup({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <details className="group border-ink-700 rounded-lg border">
      <summary className="text-ink-300 hover:bg-ink-800 flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors">
        <span>{t('meshtasticExtraConfig.advancedHardware')}</span>
        <DetailsChevron />
      </summary>
      <div className="space-y-4 px-3 pb-3">{children}</div>
    </details>
  );
}
