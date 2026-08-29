import type { ReticulumInterfaceMode } from '@/renderer/lib/reticulum/reticulumInterfaceMode';
import catalogJson from '@/shared/reticulumInterfaceCatalog.json';

/**
 * Shared Reticulum interface-type catalog.
 *
 * This reads the exact same JSON the Rust sidecar compiles in via `include_str!`
 * (`reticulum-sidecar/src/stack/interface_catalog.rs`), so supported types,
 * config type names, default modes, and flow-control policy cannot drift.
 */

export type ReticulumCatalogFieldKind = 'text' | 'number' | 'select' | 'bool' | 'serialPort';

/** `InterfaceRow` field a form field maps to; absent means it rides in `extra_config`. */
export type ReticulumCatalogFieldBind =
  'serial_port' | 'port' | 'host' | 'callsign' | 'flow_control';

export interface ReticulumCatalogField {
  key: string;
  kind: ReticulumCatalogFieldKind;
  bind?: ReticulumCatalogFieldBind;
  required?: boolean;
  default?: string | number | boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  options?: readonly string[];
  advanced?: boolean;
}

export interface ReticulumCatalogEntry {
  configType: string;
  label: string;
  defaultMode: ReticulumInterfaceMode | null;
  classify: 'rf' | 'ble' | 'tcp' | 'network';
  requiresStackRestart: boolean;
  usesSerialPort: boolean;
  supportsFlowControl: boolean;
  defaultFlowControl: boolean | null;
  purposeKey: string;
  fields: readonly ReticulumCatalogField[];
}

/** UI type keys, as a literal union inferred from the shared JSON. */
export type ReticulumIfaceUiType = keyof typeof catalogJson.types;

export const RETICULUM_INTERFACE_CATALOG = Object.freeze(
  catalogJson.types as unknown as Record<ReticulumIfaceUiType, ReticulumCatalogEntry>,
);

/** Stable, sorted list of UI type keys. */
export const RETICULUM_IFACE_UI_TYPES = Object.freeze(
  (Object.keys(RETICULUM_INTERFACE_CATALOG) as ReticulumIfaceUiType[]).sort(),
);

/** Lookup tolerant of arbitrary strings (config rows may carry unknown types). */
export function reticulumCatalogEntry(ifaceType: string): ReticulumCatalogEntry | null {
  return (
    (RETICULUM_INTERFACE_CATALOG as Record<string, ReticulumCatalogEntry | undefined>)[ifaceType] ??
    null
  );
}

/** Form fields for a type. Types with bespoke UI return an empty list. */
export function reticulumCatalogFields(ifaceType: string): readonly ReticulumCatalogField[] {
  return reticulumCatalogEntry(ifaceType)?.fields ?? [];
}

export function isReticulumCatalogType(ifaceType: string): ifaceType is ReticulumIfaceUiType {
  return Object.hasOwn(RETICULUM_INTERFACE_CATALOG, ifaceType);
}

/** i18n key for a catalog field label (`connectionPanel.reticulumInterfaces.field.*`). */
export function reticulumCatalogFieldLabelKey(field: ReticulumCatalogField): string {
  return `connectionPanel.reticulumInterfaces.field.${field.key}`;
}

/**
 * Validate a raw form value against a field descriptor.
 * Returns an i18n key on failure, or null when valid. Mirrors the sidecar's
 * `validate_catalog_fields` so the user sees the error before the round-trip.
 */
export function validateReticulumCatalogField(
  field: ReticulumCatalogField,
  raw: string,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return field.required ? 'connectionPanel.reticulumInterfaces.fieldRequired' : null;
  }
  if (field.kind === 'number') {
    if (!/^-?\d+$/.test(trimmed)) {
      return 'connectionPanel.reticulumInterfaces.fieldNotANumber';
    }
    const value = Number(trimmed);
    if (field.min != null && value < field.min) {
      return 'connectionPanel.reticulumInterfaces.fieldOutOfRange';
    }
    if (field.max != null && value > field.max) {
      return 'connectionPanel.reticulumInterfaces.fieldOutOfRange';
    }
  }
  if (field.maxLength != null && trimmed.length > field.maxLength) {
    return 'connectionPanel.reticulumInterfaces.fieldTooLong';
  }
  if (field.kind === 'select' && field.options && !field.options.includes(trimmed)) {
    return 'connectionPanel.reticulumInterfaces.fieldInvalidOption';
  }
  return null;
}
