import type { TFunction } from 'i18next';

function cfgBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function cfgNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Client-side checks aligned with firmware SerialModule::isValidConfig. */
export function validateMeshtasticSerialModuleApply(
  value: Record<string, unknown>,
  t: TFunction,
): string | null {
  const enabled = cfgBool(value.enabled, false);
  if (!enabled) return null;

  if (!cfgBool(value.overrideConsoleSerialPort, false)) return null;

  const mode = cfgNum(value.mode, 0);
  if (mode <= 0) {
    return t('modulePanel.errors.serialOverrideRequiresMode');
  }

  return null;
}
