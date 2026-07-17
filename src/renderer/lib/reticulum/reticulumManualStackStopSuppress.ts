/**
 * Shared across all useReticulumSidecarApi mounts (StackPanel vs AutostartCoordinator).
 * Manual Stop must suppress autostart on the coordinator even when notify runs on the panel.
 */

let manualStackStopSuppress = false;

export function setReticulumManualStackStopSuppress(suppressed: boolean): void {
  manualStackStopSuppress = suppressed;
}

export function isReticulumManualStackStopSuppress(): boolean {
  return manualStackStopSuppress;
}

export function resetReticulumManualStackStopSuppressForTests(): void {
  manualStackStopSuppress = false;
}
