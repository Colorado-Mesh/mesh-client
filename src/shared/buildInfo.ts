/**
 * Compile-time CI build stamp for packaged binaries.
 *
 * Set at main-process esbuild time via `--define:__MESH_CLIENT_BUILD_INFO__=...`
 * from env `MESH_CLIENT_BUILD_INFO` (see scripts/esbuild-main-build.mjs and
 * scripts/ci-write-build-info-env.mjs). Empty / unset → local unmarked build.
 */

export type BuildChannel = 'test' | 'release' | 'local';

export interface MeshClientBuildInfo {
  buildChannel: BuildChannel;
  workflow?: string;
  runNumber?: number;
  runId?: string;
  runUrl?: string;
  sha?: string;
  tag?: string;
}

/** Injected by esbuild; absent in unit tests / unmarked local builds. */
declare const __MESH_CLIENT_BUILD_INFO__: string | undefined;

const BUILD_CHANNELS = new Set<BuildChannel>(['test', 'release', 'local']);

function readCompileTimeRaw(): string {
  // typeof on an undeclared binding is safe in JS (returns 'undefined').
  return typeof __MESH_CLIENT_BUILD_INFO__ === 'string' ? __MESH_CLIENT_BUILD_INFO__ : '';
}

function normalizeChannel(raw: unknown): BuildChannel {
  if (typeof raw === 'string' && BUILD_CHANNELS.has(raw as BuildChannel)) {
    return raw as BuildChannel;
  }
  return 'local';
}

function optionalNonEmptyString(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalRunNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    return Number(raw.trim());
  }
  return undefined;
}

/**
 * Parse a MESH_CLIENT_BUILD_INFO JSON string into a normalized build stamp.
 * Never throws — invalid JSON or unknown channel falls back to `local`.
 */
export function parseBuildInfo(raw: string): MeshClientBuildInfo {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { buildChannel: 'local' };
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { buildChannel: 'local' };
    }
    const obj = parsed as Record<string, unknown>;
    const buildChannel = normalizeChannel(obj.channel ?? obj.buildChannel);
    const info: MeshClientBuildInfo = { buildChannel };
    const workflow = optionalNonEmptyString(obj.workflow);
    if (workflow) info.workflow = workflow;
    const runNumber = optionalRunNumber(obj.runNumber);
    if (runNumber !== undefined) info.runNumber = runNumber;
    const runId = optionalNonEmptyString(obj.runId);
    if (runId) info.runId = runId;
    const runUrl = optionalNonEmptyString(obj.runUrl);
    if (runUrl) info.runUrl = runUrl;
    const sha = optionalNonEmptyString(obj.sha);
    if (sha) info.sha = sha;
    const tag = optionalNonEmptyString(obj.tag);
    if (tag) info.tag = tag;
    return info;
  } catch {
    // catch-no-log-ok invalid CI stamp — fall back to local so exports still work
    return { buildChannel: 'local' };
  }
}

/** Build stamp baked into the main-process bundle (or `local` when unmarked). */
export function getBuildInfo(): MeshClientBuildInfo {
  return parseBuildInfo(readCompileTimeRaw());
}

/**
 * Compact fragment for {@link formatRuntimeLogTag} / startup logs.
 * Full `runUrl` stays in support-bundle manifest JSON for triage.
 */
export function formatBuildInfoLogFragment(info: MeshClientBuildInfo = getBuildInfo()): string {
  const parts: string[] = [`buildChannel=${info.buildChannel}`];
  if (info.tag) parts.push(`tag=${info.tag}`);
  if (info.runNumber !== undefined) parts.push(`run=${info.runNumber}`);
  if (info.runId) parts.push(`runId=${info.runId}`);
  if (info.sha) parts.push(`sha=${info.sha}`);
  return parts.join(' ');
}

/**
 * Fields to merge into support-bundle `manifest.json`.
 * Always includes `buildChannel`; adds `buildInfo` when CI look-up fields exist.
 */
export function buildInfoForManifest(info: MeshClientBuildInfo = getBuildInfo()): {
  buildChannel: BuildChannel;
  buildInfo?: Record<string, string | number>;
} {
  const buildInfo: Record<string, string | number> = {};
  if (info.workflow) buildInfo.workflow = info.workflow;
  if (info.runNumber !== undefined) buildInfo.runNumber = info.runNumber;
  if (info.runId) buildInfo.runId = info.runId;
  if (info.runUrl) buildInfo.runUrl = info.runUrl;
  if (info.sha) buildInfo.sha = info.sha;
  if (info.tag) buildInfo.tag = info.tag;
  if (Object.keys(buildInfo).length === 0) {
    return { buildChannel: info.buildChannel };
  }
  return { buildChannel: info.buildChannel, buildInfo };
}
