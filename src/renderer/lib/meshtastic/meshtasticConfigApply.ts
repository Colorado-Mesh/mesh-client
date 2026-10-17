/** Narrow unknown config payloads from IPC/protobuf to a plain record for field reads. */
export function meshtasticConfigSlice(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/** True when a config slice has arrived from the device (safe to apply without overwriting with form defaults). */
export function meshtasticConfigSliceHydrated(raw: unknown): boolean {
  return Object.keys(meshtasticConfigSlice(raw)).length > 0;
}

/** Strip protobuf metadata before sending config back to the radio. */
export function stripMeshtasticProtobufMeta(cfg: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...cfg };
  delete rest.$typeName;
  return rest;
}

/**
 * Stable signature for "did this device slice change?" comparisons.
 *
 * Protobufs 2.8.0 decodes 64-bit fields (e.g. `PowerConfig.powermon_enables`) as `bigint`,
 * which plain `JSON.stringify` throws on.
 */
export function meshtasticConfigSignature(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) =>
    typeof val === 'bigint' ? `${val.toString()}n` : val,
  );
}

/**
 * Merge device-owned config with UI edits so hidden fields are not cleared on apply.
 * Firmware setConfig/setModuleConfig replaces the full protobuf struct.
 */
export function mergeMeshtasticConfigApplyValue(
  deviceCfg: unknown,
  uiOverrides: Record<string, unknown>,
): Record<string, unknown> {
  const base = stripMeshtasticProtobufMeta(meshtasticConfigSlice(deviceCfg));
  return { ...base, ...uiOverrides };
}

/** Thin wrapper for ModulePanel module applies keyed by protobuf case name. */
export function buildMeshtasticModuleApplyValue(
  _moduleCase: string,
  deviceCfg: unknown,
  uiOverrides: Record<string, unknown>,
): Record<string, unknown> {
  return mergeMeshtasticConfigApplyValue(deviceCfg, uiOverrides);
}

export interface ResolvedMeshtasticModuleConfigs {
  /**
   * For UI visibility/forms: last-known modules under live slices so TAK etc. do not
   * vanish mid-rehydrate. Never use this alone for Apply readiness or apply merge base.
   */
  display: Record<string, unknown>;
  /** Live device/local slices only — Apply readiness and setModuleConfig merge base. */
  live: Record<string, unknown>;
}

/**
 * Resolve module config maps for UI during (re)configure.
 * Live slices come only from the device store (or local hook state). Last-known is
 * merged underneath for display so partial configure cannot hide modules (e.g. TAK).
 */
export function resolveMeshtasticModuleConfigs(args: {
  fromStore: Record<string, unknown>;
  fromLocal: Record<string, unknown>;
  lastKnown: Record<string, unknown>;
}): ResolvedMeshtasticModuleConfigs {
  const live =
    Object.keys(args.fromStore).length > 0
      ? args.fromStore
      : Object.keys(args.fromLocal).length > 0
        ? args.fromLocal
        : {};
  return {
    live,
    display: { ...args.lastKnown, ...live },
  };
}
