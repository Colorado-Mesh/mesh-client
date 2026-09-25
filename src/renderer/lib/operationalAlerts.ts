import { MS_PER_MINUTE } from '@/shared/timeConstants';

export interface SilenceAlertOptions {
  lastHeardMs: number | null | undefined;
  nowMs: number;
  thresholdMinutes: number;
  alreadyFiredForCycle: boolean;
}

export const SILENCE_ESCALATION_MULTIPLIER = 2;

function silenceExceeds(opts: SilenceAlertOptions, multiplier: number): boolean {
  if (opts.alreadyFiredForCycle) return false;
  const { lastHeardMs, nowMs, thresholdMinutes } = opts;
  if (typeof lastHeardMs !== 'number' || !Number.isFinite(lastHeardMs) || lastHeardMs <= 0) {
    return false;
  }
  if (!Number.isFinite(nowMs) || !Number.isFinite(thresholdMinutes) || thresholdMinutes <= 0) {
    return false;
  }
  // Future lastHeard (device clock skew) counts as just heard.
  return nowMs - lastHeardMs >= thresholdMinutes * multiplier * MS_PER_MINUTE;
}

/** Never-heard nodes (no lastHeard) are not "silent"; they have no baseline to compare against. */
export function shouldFireSilenceAlert(opts: SilenceAlertOptions): boolean {
  return silenceExceeds(opts, 1);
}

export function shouldFireSilenceEscalation(opts: SilenceAlertOptions): boolean {
  return silenceExceeds(opts, SILENCE_ESCALATION_MULTIPLIER);
}

export interface BatteryLowOptions {
  batteryPercent: number | null | undefined;
  thresholdPercent: number;
  protocolHasBattery: boolean;
  alreadyFiredForCycle: boolean;
}

/** Meshtastic reports 101 when on external power; any value above 100 is charging. */
const BATTERY_MAX_PERCENT = 100;

export function shouldFireBatteryLow(opts: BatteryLowOptions): boolean {
  if (!opts.protocolHasBattery || opts.alreadyFiredForCycle) return false;
  const { batteryPercent, thresholdPercent } = opts;
  if (typeof batteryPercent !== 'number' || !Number.isFinite(batteryPercent)) return false;
  // 0 is how several firmwares report "unknown".
  if (batteryPercent <= 0 || batteryPercent > BATTERY_MAX_PERCENT) return false;
  if (!Number.isFinite(thresholdPercent) || thresholdPercent <= 0) return false;
  return batteryPercent <= thresholdPercent;
}

export interface LinkDownOptions {
  wasConnected: boolean;
  isConnected: boolean;
  isManualDisconnect: boolean;
  isReconnectInProgress: boolean;
}

export function shouldFireLinkDown(opts: LinkDownOptions): boolean {
  return (
    opts.wasConnected &&
    !opts.isConnected &&
    !opts.isManualDisconnect &&
    !opts.isReconnectInProgress
  );
}
