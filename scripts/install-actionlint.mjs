import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const outDir = join(repoRoot, '.githooks', 'bin');

/** Bump the version and every platform digest together after reviewing the upstream release. */
export const PINNED_ACTIONLINT_VERSION = '1.7.12';

const ACTIONLINT_ARCHIVE_SHA256 = Object.freeze({
  darwin_amd64: '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644',
  darwin_arm64: 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
  linux_amd64: '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
  linux_arm64: '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
  windows_amd64: '6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9',
  windows_arm64: 'cadcf7ea4efe3a68728893813643cebe1185e5b1d4be5b96245f65c9a4d5ea41',
});

export function normalizeArch(arch = process.arch) {
  switch (arch) {
    case 'x64':
      return 'amd64';
    case 'arm64':
      return 'arm64';
    default:
      return null;
  }
}

export function normalizeOs(platform = process.platform) {
  switch (platform) {
    case 'darwin':
      return 'darwin';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      return null;
  }
}

/** Construct a release asset URL without calling the GitHub Releases API. */
export function pinnedActionlintAsset(osKey, archKey, version = PINNED_ACTIONLINT_VERSION) {
  if (version !== PINNED_ACTIONLINT_VERSION) {
    throw new Error(`No reviewed actionlint checksum is available for v${version}`);
  }
  const sha256 = ACTIONLINT_ARCHIVE_SHA256[`${osKey}_${archKey}`];
  if (!sha256) return null;
  const expectedExt = osKey === 'windows' ? '.zip' : '.tar.gz';
  const name = `actionlint_${version}_${osKey}_${archKey}${expectedExt}`;
  return {
    name,
    browser_download_url: `https://github.com/rhysd/actionlint/releases/download/v${version}/${name}`,
    sha256,
  };
}

export async function sha256File(filePath) {
  const bytes = await fs.readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

export async function verifySha256(filePath, expectedSha256) {
  const actualSha256 = await sha256File(filePath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `SHA-256 mismatch for ${filePath}: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download a URL to disk with retries for transient CDN / network failures
 * (Node `fetch failed`, 5xx, etc.). Used by CI `setup:actionlint`.
 *
 * @param {string} url
 * @param {string} destinationPath
 * @param {Record<string, string>} headers
 * @param {{
 *   attempts?: number,
 *   baseDelayMs?: number,
 *   fetchImpl?: typeof fetch,
 *   sleepImpl?: (ms: number) => Promise<void>,
 *   warn?: (...args: unknown[]) => void,
 * }} [opts]
 */
export async function downloadToFile(
  url,
  destinationPath,
  headers,
  {
    attempts = 5,
    baseDelayMs = 500,
    fetchImpl = fetch,
    sleepImpl = sleep,
    warn = console.warn,
  } = {},
) {
  let lastError = /** @type {unknown} */ (null);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetchImpl(url, { headers, redirect: 'follow' });
      if (!res.ok) {
        throw new Error(`Failed to download: ${res.status} ${res.statusText}`);
      }
      if (!res.body) {
        throw new Error('Failed to download: empty response body');
      }
      const file = createWriteStream(destinationPath);
      await pipeline(res.body, file);
      return;
    } catch (err) {
      lastError = err;
      try {
        await fs.unlink(destinationPath);
      } catch {
        // catch-no-log-ok partial download may not exist
      }
      if (attempt >= attempts) break;
      const delayMs = Math.min(8_000, baseDelayMs * 2 ** (attempt - 1));
      warn(
        `[install-actionlint] download attempt ${attempt}/${attempts} failed: ${
          err instanceof Error ? err.message : String(err)
        } — retrying in ${delayMs}ms`,
      );
      await sleepImpl(delayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function findFileRecursively(startDir, targetNames, maxDepth, depth = 0) {
  if (depth > maxDepth) return null;
  let entries;
  try {
    entries = await fs.readdir(startDir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const e of entries) {
    const fullPath = join(startDir, e.name);
    if (e.isFile() && targetNames.includes(e.name)) return fullPath;
    if (e.isDirectory()) {
      const found = await findFileRecursively(fullPath, targetNames, maxDepth, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function main() {
  const osKey = normalizeOs();
  const archKey = normalizeArch();
  if (!osKey || !archKey) {
    console.error(`Unsupported platform/arch for actionlint: ${process.platform}/${process.arch}`);
    process.exit(1);
  }

  const binName = osKey === 'windows' ? 'actionlint.exe' : 'actionlint';
  const destPath = join(outDir, binName);
  await fs.mkdir(outDir, { recursive: true });

  // Always replace the destination from a freshly authenticated archive. Trusting an
  // existing executable would let a poisoned workspace cache bypass verification.
  const asset = pinnedActionlintAsset(osKey, archKey);
  if (!asset) {
    console.error(`No reviewed actionlint asset for ${osKey}/${archKey}`);
    process.exit(1);
  }

  const tmpBase = await fs.mkdtemp(join(tmpdir(), 'actionlint-'));
  const archivePath = join(tmpBase, asset.name);

  try {
    console.log(`Downloading ${asset.name}...`);
    await downloadToFile(asset.browser_download_url, archivePath, {
      'User-Agent': 'mesh-client',
    });
    await verifySha256(archivePath, asset.sha256);

    console.log('Extracting verified archive...');
    if (osKey === 'windows') {
      const ps = [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${tmpBase}' -Force`,
      ];
      const x = spawnSync('powershell', ps, { stdio: 'inherit' });
      if (x.status !== 0) {
        throw new Error(
          `Failed to extract ${asset.name} with Expand-Archive (exit ${x.status ?? 1}).`,
        );
      }
    } else {
      const x = spawnSync('tar', ['-xzf', archivePath, '-C', tmpBase], {
        stdio: 'inherit',
      });
      if (x.status !== 0) throw new Error(`Failed to extract ${asset.name}.`);
    }

    const found = await findFileRecursively(tmpBase, [binName], 6);
    if (!found) throw new Error('Extracted actionlint binary not found.');

    const pendingPath = `${destPath}.pending`;
    await fs.rm(pendingPath, { force: true });
    await fs.copyFile(found, pendingPath);
    if (osKey !== 'windows') await fs.chmod(pendingPath, 0o755);
    await fs.rm(destPath, { force: true });
    await fs.rename(pendingPath, destPath);
  } finally {
    await fs.rm(tmpBase, { recursive: true, force: true });
  }

  console.log(`Installed actionlint to ${destPath}`);
  console.log("If your pre-commit hook can't find it, ensure PATH includes .githooks/bin.");
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
