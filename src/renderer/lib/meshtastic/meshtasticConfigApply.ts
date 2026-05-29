/** Narrow unknown config payloads from IPC/protobuf to a plain record for field reads. */
export function meshtasticConfigSlice(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/** Strip protobuf metadata before sending config back to the radio. */
export function stripMeshtasticProtobufMeta(cfg: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...cfg };
  delete rest.$typeName;
  return rest;
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
