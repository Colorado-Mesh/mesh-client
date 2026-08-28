import { useTranslation } from 'react-i18next';

import type {
  ReticulumCatalogField,
  ReticulumCatalogFieldBind,
} from '@/renderer/lib/reticulum/reticulumInterfaceCatalog';
import {
  reticulumCatalogFieldLabelKey,
  validateReticulumCatalogField,
} from '@/renderer/lib/reticulum/reticulumInterfaceCatalog';

export interface ReticulumSerialPortChoice {
  path: string;
  label?: string | null;
}

export interface ReticulumInterfaceFieldSetProps {
  /** Unique per form instance so add and edit dialogs do not share element ids. */
  idPrefix: string;
  fields: readonly ReticulumCatalogField[];
  values: Readonly<Record<string, string>>;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
  serialPorts?: readonly ReticulumSerialPortChoice[];
}

const INPUT_CLASS =
  'mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-50';

function fieldValue(
  field: ReticulumCatalogField,
  values: Readonly<Record<string, string>>,
): string {
  const current = values[field.key];
  if (current != null) return current;
  return field.default == null ? '' : String(field.default);
}

/**
 * Renders the form controls for a catalog-declared interface type.
 *
 * Types with bespoke UI (RNode transport selector, presets, BLE picker) declare
 * no catalog fields and keep their hand-written controls; this covers the
 * declarative types so adding one needs no new JSX branch.
 */
export function ReticulumInterfaceFieldSet({
  idPrefix,
  fields,
  values,
  onChange,
  disabled = false,
  serialPorts = [],
}: ReticulumInterfaceFieldSetProps) {
  const { t } = useTranslation();
  if (fields.length === 0) return null;

  const basic = fields.filter((f) => !f.advanced);
  const advanced = fields.filter((f) => f.advanced);

  const renderField = (field: ReticulumCatalogField) => {
    const id = `${idPrefix}-${field.key}`;
    const value = fieldValue(field, values);
    const label = t(reticulumCatalogFieldLabelKey(field), { defaultValue: field.key });
    const errorKey = validateReticulumCatalogField(field, value);
    // Only surface an error once the user has typed something; an untouched
    // required field is flagged on submit, not while the form is still blank.
    const showError = errorKey != null && value.trim().length > 0;

    if (field.kind === 'bool') {
      return (
        <label key={field.key} className="flex items-center gap-2 text-xs text-gray-400">
          <input
            id={id}
            type="checkbox"
            checked={value === 'true' || value === 'Yes'}
            disabled={disabled}
            onChange={(e) => {
              onChange(field.key, e.target.checked ? 'true' : 'false');
            }}
            aria-label={label}
            className="h-4 w-4 rounded border-gray-600 bg-slate-900 disabled:opacity-50"
          />
          {label}
        </label>
      );
    }

    if (field.kind === 'select') {
      return (
        <label key={field.key} className="text-xs text-gray-400" htmlFor={id}>
          {label}
          <select
            id={id}
            value={value}
            disabled={disabled}
            onChange={(e) => {
              onChange(field.key, e.target.value);
            }}
            aria-label={label}
            className={INPUT_CLASS}
          >
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {t(`connectionPanel.reticulumInterfaces.fieldOption.${field.key}.${option}`, {
                  defaultValue: option,
                })}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (field.kind === 'serialPort') {
      return (
        <label key={field.key} className="text-xs text-gray-400" htmlFor={id}>
          {label}
          {serialPorts.length > 0 ? (
            <select
              id={id}
              value={value}
              disabled={disabled}
              onChange={(e) => {
                onChange(field.key, e.target.value);
              }}
              aria-label={label}
              className={INPUT_CLASS}
            >
              <option value="">{t('common.emDash')}</option>
              {serialPorts.map((port) => (
                <option key={port.path} value={port.path}>
                  {port.label ?? port.path}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={id}
              value={value}
              disabled={disabled}
              onChange={(e) => {
                onChange(field.key, e.target.value);
              }}
              aria-label={label}
              className={INPUT_CLASS}
            />
          )}
        </label>
      );
    }

    return (
      <label key={field.key} className="text-xs text-gray-400" htmlFor={id}>
        {label}
        <input
          id={id}
          value={value}
          inputMode={field.kind === 'number' ? 'numeric' : undefined}
          maxLength={field.maxLength}
          disabled={disabled}
          onChange={(e) => {
            onChange(field.key, e.target.value);
          }}
          aria-label={label}
          aria-invalid={showError || undefined}
          aria-describedby={showError ? `${id}-error` : undefined}
          className={`${INPUT_CLASS} ${field.kind === 'number' ? 'w-24' : 'min-w-[8rem]'}`}
        />
        {showError ? (
          <span id={`${id}-error`} role="alert" className="mt-1 block text-[11px] text-red-300">
            {t(errorKey)}
          </span>
        ) : null}
      </label>
    );
  };

  return (
    <>
      {basic.map(renderField)}
      {advanced.length > 0 ? (
        <details className="w-full text-xs text-gray-400">
          <summary className="cursor-pointer text-gray-300">
            {t('connectionPanel.reticulumInterfaces.advancedFields')}
          </summary>
          <div className="mt-2 flex flex-wrap items-end gap-2">{advanced.map(renderField)}</div>
        </details>
      ) : null}
    </>
  );
}

/**
 * Fold catalog field values into an add/edit request body. Bound fields land on
 * their typed `InterfaceRow` slot; unbound fields ride in `extra_config`, which
 * the sidecar preserves verbatim.
 */
export function applyReticulumCatalogFieldsToBody(
  body: Record<string, unknown>,
  fields: readonly ReticulumCatalogField[],
  values: Readonly<Record<string, string>>,
): void {
  if (fields.length === 0) return;
  const extra: Record<string, string> = {
    ...((body.extra_config as Record<string, string> | undefined) ?? {}),
  };

  for (const field of fields) {
    const raw = fieldValue(field, values).trim();
    if (!raw) continue;

    const bind: ReticulumCatalogFieldBind | undefined = field.bind;
    if (bind === 'flow_control') {
      body[bind] = raw === 'true' || raw === 'Yes';
      continue;
    }
    if (bind === 'port') {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) body[bind] = parsed;
      continue;
    }
    if (bind) {
      body[bind] = raw;
      continue;
    }
    extra[field.key] = raw;
  }

  if (Object.keys(extra).length > 0) {
    body.extra_config = extra;
  }
}

/**
 * First validation error across a catalog field set, or null when all pass.
 * Unlike the per-control display this also flags untouched required fields, so
 * it is the submit-time gate.
 */
export function firstReticulumCatalogFieldError(
  fields: readonly ReticulumCatalogField[],
  values: Readonly<Record<string, string>>,
): { field: ReticulumCatalogField; errorKey: string } | null {
  for (const field of fields) {
    const errorKey = validateReticulumCatalogField(field, fieldValue(field, values));
    if (errorKey != null) {
      return { field, errorKey };
    }
  }
  return null;
}
