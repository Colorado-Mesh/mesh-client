/** Meshtastic device.configure / NodeDB replay phase — shared by nodeStore and wireEffects. */

let configuring = false;
let onConfigureProgress: (() => void) | null = null;

export function setMeshtasticConfigurePhase(value: boolean): void {
  configuring = value;
  // Progress handler lifetime == wire attach lifetime (cleared on detach / test reset only).
}

export function getMeshtasticConfigurePhase(): boolean {
  return configuring;
}

/** Register BLE configure stall watchdog reset (wireEffects only). */
export function setMeshtasticConfigureProgressHandler(handler: (() => void) | null): void {
  onConfigureProgress = handler;
}

/** Reset configure stall timer while NodeDB / FromRadio frames still arrive. */
export function touchMeshtasticConfigureProgress(): void {
  if (!configuring) return;
  onConfigureProgress?.();
}

/** Test-only reset. */
export function resetMeshtasticConfigurePhaseForTests(): void {
  configuring = false;
  onConfigureProgress = null;
}
