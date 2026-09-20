import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

/**
 * After a BLE RNode reports online, clear latched `bleBondRemoved` /
 * `blePairingTimedOut` banners in main so Connection updates immediately
 * (without waiting for the 5-minute stale window or a stack restart).
 */
export async function clearReticulumBleBondIssuesForOnlineInterfaces(
  onlineNames: readonly string[],
): Promise<void> {
  const names = [...new Set(onlineNames.map((n) => n.trim()).filter(Boolean))];
  if (names.length === 0) return;
  try {
    await window.electronAPI.reticulum.clearBleBondIssuesForOnlineInterfaces(names);
  } catch (e: unknown) {
    console.debug('[reticulum] clearBleBondIssuesForOnlineInterfaces ' + errLikeToLogString(e));
  }
}
