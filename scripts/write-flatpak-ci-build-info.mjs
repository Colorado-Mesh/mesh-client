#!/usr/bin/env node
/**
 * Write flatpak/ci-build-info.json for the Flatpak sandbox build.
 *
 * The Flatpak manifest exports MESH_CLIENT_BUILD_INFO from this file before
 * `pnpm run build` so esbuild embeds the same stamp as electron-builder CI.
 *
 * Prefer MESH_CLIENT_BUILD_INFO already in the environment (after
 * ci-write-build-info-env.mjs). Otherwise builds the payload from Actions env.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildMeshClientBuildInfoPayload,
  readReleaseTagFromPackageJson,
} from './ci-write-build-info-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
export const FLATPAK_CI_BUILD_INFO_REL = path.join('flatpak', 'ci-build-info.json');

/**
 * @param {string} raw
 * @returns {Record<string, string | number>}
 */
export function parseBuildInfoJsonObject(raw) {
  const parsed = JSON.parse(raw);
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MESH_CLIENT_BUILD_INFO must be a JSON object');
  }
  return /** @type {Record<string, string | number>} */ (parsed);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ packageJsonPath?: string, outPath?: string }} [opts]
 * @returns {{ payload: Record<string, string | number>, outPath: string }}
 */
export function writeFlatpakCiBuildInfoFile(env = process.env, opts = {}) {
  const outPath = opts.outPath ?? path.join(ROOT, FLATPAK_CI_BUILD_INFO_REL);
  const existing = env.MESH_CLIENT_BUILD_INFO?.trim();
  /** @type {Record<string, string | number>} */
  let payload;
  if (existing) {
    payload = parseBuildInfoJsonObject(existing);
  } else {
    const channel = env.MESH_CLIENT_BUILD_CHANNEL?.trim();
    if (channel !== 'test' && channel !== 'release') {
      throw new Error(
        `MESH_CLIENT_BUILD_CHANNEL must be test|release, got: ${String(env.MESH_CLIENT_BUILD_CHANNEL)}`,
      );
    }
    let tag = env.MESH_CLIENT_BUILD_TAG?.trim();
    if (channel === 'release' && !tag) {
      tag = readReleaseTagFromPackageJson(opts.packageJsonPath);
    }
    payload = buildMeshClientBuildInfoPayload({
      channel,
      workflow: env.MESH_CLIENT_BUILD_WORKFLOW,
      runId: env.GITHUB_RUN_ID,
      runNumber: env.GITHUB_RUN_NUMBER,
      sha: env.GITHUB_SHA,
      serverUrl: env.GITHUB_SERVER_URL,
      repository: env.GITHUB_REPOSITORY,
      tag,
    });
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload)}\n`, 'utf8');
  return { payload, outPath };
}

/**
 * Shell snippet used in org.coloradomesh.MeshClient.yml before pnpm run build.
 * Kept as a constant so check-flatpak can assert the contract.
 */
export const FLATPAK_BUILD_INFO_EXPORT_SNIPPET = [
  'if [ -f flatpak/ci-build-info.json ]; then',
  '  export MESH_CLIENT_BUILD_INFO="$(cat flatpak/ci-build-info.json)"',
  'fi',
  'pnpm run build',
].join('\n');

function main() {
  const { payload, outPath } = writeFlatpakCiBuildInfoFile();
  process.stdout.write(
    `Wrote ${path.relative(ROOT, outPath)} channel=${payload.channel}` +
      (payload.runNumber != null ? ` runNumber=${payload.runNumber}` : '') +
      '\n',
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
