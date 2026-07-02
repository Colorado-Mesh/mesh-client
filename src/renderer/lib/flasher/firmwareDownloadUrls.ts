/** Firmware release pages — same URLs as liamcottle/rnode-flasher index.html. */
export const RNODE_FIRMWARE_RELEASES_URL = 'https://github.com/markqvist/RNode_Firmware/releases';
export const RNODE_FIRMWARE_CE_RELEASES_URL =
  'https://github.com/liberatedsystems/RNode_Firmware_CE/releases';
export const RNODE_TRANSPORT_NODE_RELEASES_URL =
  'https://github.com/attermann/microReticulum_Firmware/releases';

const RNODE_FIRMWARE_LATEST_RELEASE_API =
  'https://api.github.com/repos/markqvist/RNode_Firmware/releases/latest';

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

/** Fallback when the GitHub API is unavailable — still resolves GitHub "latest" redirect. */
export function buildOfficialFirmwareDownloadUrl(filename: string): string {
  return `https://github.com/markqvist/RNode_Firmware/releases/latest/download/${encodeURIComponent(filename)}`;
}

/** Resolve the current latest-release asset URL from the GitHub Releases API. */
export async function resolveLatestOfficialFirmwareDownloadUrl(filename: string): Promise<string> {
  try {
    const response = await fetch(RNODE_FIRMWARE_LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      return buildOfficialFirmwareDownloadUrl(filename);
    }
    const body = (await response.json()) as { assets?: GitHubReleaseAsset[] };
    const asset = body.assets?.find((entry) => entry.name === filename);
    return asset?.browser_download_url ?? buildOfficialFirmwareDownloadUrl(filename);
  } catch {
    // catch-no-log-ok GitHub API unreachable — fall back to /releases/latest/download
    return buildOfficialFirmwareDownloadUrl(filename);
  }
}
