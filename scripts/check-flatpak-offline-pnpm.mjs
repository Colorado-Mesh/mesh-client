#!/usr/bin/env node
/**
 * PR/release-cycle check: Flatpak offline pnpm sources use the store version
 * matching package.json packageManager, and cover lockfile tarballs.
 *
 * Failure point: flatpak-node-generator defaults to store v10 for lockfile 9 while
 * pnpm 11 reads v11 → ERR_PNPM_NO_OFFLINE_TARBALL (@bufbuild/protobuf, etc.).
 * Fallback: require --pnpm-store-version vN, regenerate, assert coverage.
 *
 * Not run in pre-commit (needs flatpak-node-generator). Used by CI / act:pr / release.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FLATPAK_NODE_GENERATOR_COMMIT,
  FLATPAK_NODE_GENERATOR_GIT,
  flatpakWorkflowStoreVersionViolations,
  lockfilePackageIdToTarballName,
  missingOfflineTarballs,
  parseGeneratedPnpmManifest,
  listLockfilePackageIds,
  storeVersionFromPackageManager,
} from './flatpakPnpmStoreVersion.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG = path.join(ROOT, 'package.json');
const LOCKFILE = path.join(ROOT, 'pnpm-lock.yaml');
const WORKFLOW = path.join(ROOT, '.github/workflows/flatpak.yaml');

/** Cap generator hangs (registry metadata) so CI fails with a clear message. */
const GENERATOR_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * @returns {string | null}
 */
function resolveGeneratorBin() {
  const fromEnv = process.env.FLATPAK_NODE_GENERATOR?.trim();
  if (fromEnv) return fromEnv;

  const which = spawnSync('which', ['flatpak-node-generator'], { encoding: 'utf8' });
  if (which.status === 0) {
    const bin = which.stdout.trim().split('\n')[0];
    if (bin) return bin;
  }
  return null;
}

/**
 * @param {string} expectedStoreVersion
 * @returns {{ ok: true, generatedPath: string } | { ok: false, message: string }}
 */
function generateOfflineSources(expectedStoreVersion) {
  const bin = resolveGeneratorBin();
  if (!bin) {
    return {
      ok: false,
      message:
        `flatpak-node-generator not found on PATH (and FLATPAK_NODE_GENERATOR unset).\n` +
        `  Install the CI pin, then re-run:\n` +
        `    python3 -m venv .cache/flatpak-node-venv\n` +
        `    .cache/flatpak-node-venv/bin/pip install '${FLATPAK_NODE_GENERATOR_GIT}'\n` +
        `    export PATH="$PWD/.cache/flatpak-node-venv/bin:$PATH"\n` +
        `    pnpm run check:flatpak-offline-pnpm`,
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-flatpak-offline-'));
  const outPath = path.join(tmpDir, 'generated-sources.json');
  const result = spawnSync(
    bin,
    ['pnpm', LOCKFILE, '--pnpm-store-version', expectedStoreVersion, '-o', outPath],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: GENERATOR_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    },
  );

  if (result.error) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const timedOut = /** @type {{ code?: string }} */ (result.error).code === 'ETIMEDOUT';
    return {
      ok: false,
      message: timedOut
        ? `flatpak-node-generator timed out after ${GENERATOR_TIMEOUT_MS}ms`
        : `flatpak-node-generator failed to start: ${result.error.message}`,
    };
  }

  if (result.status !== 0) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return {
      ok: false,
      message:
        `flatpak-node-generator failed (exit ${result.status ?? 'null'}):\n` +
        `${result.stderr || result.stdout || '(no output)'}`,
    };
  }
  if (!fs.existsSync(outPath)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return { ok: false, message: `generator did not write ${outPath}` };
  }
  return { ok: true, generatedPath: outPath };
}

function main() {
  /** @type {{ file: string, message: string }[]} */
  const violations = [];

  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  const expectedStoreVersion = storeVersionFromPackageManager(pkg.packageManager);
  if (!expectedStoreVersion) {
    violations.push({
      file: 'package.json',
      message: 'missing valid packageManager pnpm@MAJOR.MINOR.PATCH',
    });
  } else {
    const workflowYaml = fs.readFileSync(WORKFLOW, 'utf8');
    violations.push(...flatpakWorkflowStoreVersionViolations(workflowYaml, expectedStoreVersion));

    const pinCommit = FLATPAK_NODE_GENERATOR_COMMIT;
    if (!workflowYaml.includes(pinCommit)) {
      violations.push({
        file: '.github/workflows/flatpak.yaml',
        message: `flatpak-node-generator install pin must use commit ${pinCommit} (see scripts/flatpakPnpmStoreVersion.mjs)`,
      });
    }

    const gen = generateOfflineSources(expectedStoreVersion);
    if (!gen.ok) {
      violations.push({ file: 'flatpak-node-generator', message: gen.message });
    } else {
      try {
        const sources = JSON.parse(fs.readFileSync(gen.generatedPath, 'utf8'));
        const { storeVersion, tarballNames } = parseGeneratedPnpmManifest(sources);
        if (storeVersion !== expectedStoreVersion) {
          violations.push({
            file: 'flatpak/generated-sources.json',
            message: `generated pnpm-manifest store_version is ${storeVersion ?? 'missing'}, expected ${expectedStoreVersion}`,
          });
        }
        if (tarballNames.size === 0) {
          violations.push({
            file: 'flatpak/generated-sources.json',
            message: 'generated pnpm-manifest has no packages',
          });
        }

        const lockIds = listLockfilePackageIds(fs.readFileSync(LOCKFILE, 'utf8'));
        const { missing, truncated } = missingOfflineTarballs(lockIds, tarballNames);
        if (missing.length > 0) {
          const countLabel = truncated ? `${missing.length}+` : String(missing.length);
          violations.push({
            file: 'flatpak/generated-sources.json',
            message:
              `offline store missing ${countLabel} lockfile tarball(s); sample: ${missing.slice(0, 5).join(', ')} ` +
              `(pnpm install --offline would fail with ERR_PNPM_NO_OFFLINE_TARBALL)`,
          });
        }

        // Explicit regression probe for scoped packages that failed Flatpak CI first.
        const bufbuildId = lockIds.find((id) => id.startsWith('@bufbuild/protobuf@'));
        if (bufbuildId) {
          const bufTarball = lockfilePackageIdToTarballName(bufbuildId);
          if (bufTarball && !tarballNames.has(bufTarball)) {
            violations.push({
              file: 'flatpak/generated-sources.json',
              message: `missing ${bufTarball} (Flatpak CI offline install regression)`,
            });
          }
        }
      } finally {
        fs.rmSync(path.dirname(gen.generatedPath), { recursive: true, force: true });
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `check-flatpak-offline-pnpm: ok (store ${expectedStoreVersion}, generator coverage)`,
    );
    process.exit(0);
  }

  console.error('check-flatpak-offline-pnpm:\n');
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    ${v.message}`);
    console.error('');
  }
  process.exit(1);
}

main();
