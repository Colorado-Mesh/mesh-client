/**
 * OS release string for logs and support bundles.
 * On Windows, Node's `os.release()` is only `10.0.{build}` (e.g. `10.0.26200`) and omits the
 * Update Build Revision (UBR). Append UBR from the registry so triage can tell monthly patches
 * apart (e.g. `10.0.26200.9974`).
 */
import { execFileSync } from 'node:child_process';
import { release as nodeOsRelease } from 'node:os';

interface OsReleaseObservation {
  tag: string;
  /** Windows UBR from the same registry read used to build `tag`, when available. */
  ubr: number | null;
}

let cachedObservation: OsReleaseObservation | null = null;

/** Test isolation — clear the process-lifetime cache. */
export function resetOsReleaseTagCacheForTests(): void {
  cachedObservation = null;
}

/**
 * Read HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\UBR (DWORD).
 * Returns null when not on Windows or the query fails.
 */
export function readWindowsUpdateBuildRevision(
  execFile: typeof execFileSync = execFileSync,
  platform: NodeJS.Platform = process.platform,
): number | null {
  if (platform !== 'win32') return null;
  try {
    const out = execFile(
      'reg.exe',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', '/v', 'UBR'],
      { encoding: 'utf8', windowsHide: true, timeout: 3_000 },
    );
    const m = /\bUBR\s+REG_DWORD\s+0x([0-9a-fA-F]+)\b/i.exec(out);
    if (!m?.[1]) return null;
    const n = Number.parseInt(m[1], 16);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    // catch-no-log-ok registry query optional for triage tags
    return null;
  }
}

/**
 * Compact OS identity plus optional Windows UBR from one registry observation.
 * Windows tag: `10.0.{CurrentBuild}.{UBR}` when UBR is available; otherwise `os.release()`.
 */
export function resolveOsReleaseObservation(
  platform: NodeJS.Platform = process.platform,
  baseRelease: string = nodeOsRelease(),
  readUbr: () => number | null = readWindowsUpdateBuildRevision,
): OsReleaseObservation {
  if (cachedObservation != null && platform === process.platform) {
    return cachedObservation;
  }
  let tag = baseRelease;
  let ubr: number | null = null;
  if (platform === 'win32') {
    ubr = readUbr();
    if (ubr != null) {
      const suffix = `.${ubr}`;
      if (!baseRelease.endsWith(suffix)) {
        tag = `${baseRelease}${suffix}`;
      }
    }
  }
  const observation: OsReleaseObservation = { tag, ubr };
  if (platform === process.platform) {
    cachedObservation = observation;
  }
  return observation;
}

/**
 * Compact OS identity for `os=` log/manifest fields.
 * Windows: `10.0.{CurrentBuild}.{UBR}` when UBR is available; otherwise `os.release()`.
 */
export function resolveOsReleaseTag(
  platform: NodeJS.Platform = process.platform,
  baseRelease: string = nodeOsRelease(),
  readUbr: () => number | null = readWindowsUpdateBuildRevision,
): string {
  return resolveOsReleaseObservation(platform, baseRelease, readUbr).tag;
}
