import { spawnSync } from 'node:child_process';
import { createWriteStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const outDir = join(repoRoot, '.githooks', 'bin');

/**
 * Pinned fallback when api.github.com is rate-limited (common on unauthenticated CI).
 * Bump when intentionally upgrading actionlint; asset names must match rhysd/actionlint releases.
 */
export const PINNED_ACTIONLINT_VERSION = '1.7.12';

export function githubApiHeaders(env = process.env) {
  const headers = {
    'User-Agent': 'mesh-client',
    Accept: 'application/vnd.github+json',
  };
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (typeof token === 'string' && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

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
  const expectedExt = osKey === 'windows' ? '.zip' : '.tar.gz';
  const name = `actionlint_${version}_${osKey}_${archKey}${expectedExt}`;
  return {
    name,
    browser_download_url: `https://github.com/rhysd/actionlint/releases/download/v${version}/${name}`,
  };
}

export function pickActionlintAsset(assets, osKey, archKey) {
  const expectedExt = osKey === 'windows' ? '.zip' : '.tar.gz';
  const needle = `${osKey}_${archKey}`;
  const asset = (assets ?? []).find(
    (a) =>
      typeof a?.name === 'string' &&
      a.name.includes(needle) &&
      a.name.startsWith('actionlint_') &&
      a.name.endsWith(expectedExt),
  );
  if (!asset?.browser_download_url || typeof asset.name !== 'string') return null;
  return { name: asset.name, browser_download_url: asset.browser_download_url };
}

async function downloadToFile(url, destinationPath, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to download: ${res.status} ${res.statusText}`);
  }
  const file = createWriteStream(destinationPath);
  // Pipe the response body stream into the file.
  await pipeline(res.body, file);
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
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

async function resolveActionlintAsset(osKey, archKey, headers) {
  const apiUrl = 'https://api.github.com/repos/rhysd/actionlint/releases/latest';
  try {
    const res = await fetch(apiUrl, { headers });
    if (!res.ok) {
      throw new Error(
        `Failed to query actionlint release metadata: ${res.status} ${res.statusText}`,
      );
    }
    const json = await res.json();
    const asset = pickActionlintAsset(json.assets, osKey, archKey);
    if (!asset) {
      throw new Error(`Could not find a matching actionlint asset for ${osKey}_${archKey}`);
    }
    return asset;
  } catch (err) {
    const pinned = pinnedActionlintAsset(osKey, archKey);
    console.warn(
      `[install-actionlint] ${err instanceof Error ? err.message : String(err)} — falling back to pinned v${PINNED_ACTIONLINT_VERSION} (${pinned.name})`,
    );
    return pinned;
  }
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

  if (await pathExists(destPath)) {
    console.log(`actionlint already installed at ${destPath}`);
    process.exit(0);
  }

  const headers = githubApiHeaders();
  const asset = await resolveActionlintAsset(osKey, archKey, headers);

  const tmpBase = await fs.mkdtemp(join(tmpdir(), 'actionlint-'));
  const archivePath = join(tmpBase, asset.name);

  console.log(`Downloading ${asset.name}...`);
  // Release asset CDN does not require auth; omit Authorization to avoid token leakage in logs.
  await downloadToFile(asset.browser_download_url, archivePath, {
    'User-Agent': 'mesh-client',
  });

  console.log('Extracting...');
  if (osKey === 'windows') {
    const ps = [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${tmpBase}' -Force`,
    ];
    const x = spawnSync('powershell', ps, { stdio: 'inherit' });
    if (x.status !== 0) {
      console.error(`Failed to extract ${asset.name} with Expand-Archive (exit ${x.status ?? 1}).`);
      process.exit(x.status ?? 1);
    }
  } else {
    const x = spawnSync('tar', ['-xzf', archivePath, '-C', tmpBase], {
      stdio: 'inherit',
    });
    if (x.status !== 0) process.exit(x.status ?? 1);
  }

  const found = await findFileRecursively(tmpBase, [binName], 6);
  if (!found) {
    console.error('Extracted actionlint binary not found.');
    process.exit(1);
  }

  await fs.copyFile(found, destPath);
  if (osKey !== 'windows') {
    await fs.chmod(destPath, 0o755);
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
