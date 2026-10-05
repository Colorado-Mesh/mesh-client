/** Consecutive configure→silence→watchdog-dead cycles before the user hint is shown. */
export const MESHTASTIC_SILENT_CYCLES_BEFORE_HINT = 2;

export interface MeshtasticPostConfigureSilenceTracker {
  /** Device reached `DeviceConfigured`; start a new observation window. */
  markConfigured: () => void;
  /** Live data arrived (watchdog freshness touch). */
  markData: () => void;
  /** Watchdog declared the link dead. Returns true when the hint should be shown now. */
  noteDead: () => boolean;
  /** Manual connect/disconnect: forget streaks and allow the hint again. */
  reset: () => void;
}

/**
 * Detects links that finish the config download and then deliver no live traffic until the
 * watchdog reconnects — repeatedly. Warns at most once per manual connect session.
 */
export function createMeshtasticPostConfigureSilenceTracker(
  threshold = MESHTASTIC_SILENT_CYCLES_BEFORE_HINT,
): MeshtasticPostConfigureSilenceTracker {
  let configured = false;
  let dataSinceConfigured = false;
  let silentCycles = 0;
  let warned = false;

  return {
    markConfigured: () => {
      configured = true;
      dataSinceConfigured = false;
    },
    markData: () => {
      if (!configured) return;
      dataSinceConfigured = true;
      silentCycles = 0;
    },
    noteDead: () => {
      if (!configured) return false;
      configured = false;
      if (dataSinceConfigured) {
        silentCycles = 0;
        return false;
      }
      silentCycles += 1;
      if (silentCycles < threshold || warned) return false;
      warned = true;
      return true;
    },
    reset: () => {
      configured = false;
      dataSinceConfigured = false;
      silentCycles = 0;
      warned = false;
    },
  };
}
