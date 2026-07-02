/** GitHub release URL builder for RNode firmware (deferred in-app download). */

const RNODE_FIRMWARE_REPO = 'markqvist/RNode_Firmware';

export function buildFirmwareReleaseUrl(version: string, filename: string): string {
  return `https://github.com/${RNODE_FIRMWARE_REPO}/releases/download/${version}/${filename}`;
}
