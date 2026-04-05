import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const outDir = join(repoRoot, '.githooks', 'bin');

function normalizeArch() {
  switch (process.arch) {
    case 'x64':
      return 'amd64';
    case 'arm64':
      return 'arm64';
    default:
      return null;
  }
}

function normalizeOs() {
  switch (process.platform) {
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

async function downloadToFile(url, destinationPath) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'mesh-client' },
  });
  if (!res.ok) {
    throw new Error(`Failed to download: ${res.status} ${res.statusText}`);
  }
  const file = fs.createWriteStream(destinationPath);
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

  const apiUrl = 'https://api.github.com/repos/rhysd/actionlint/releases/latest';
  const res = await fetch(apiUrl, { headers: { 'User-Agent': 'mesh-client' } });
  if (!res.ok) {
    throw new Error(`Failed to query actionlint release metadata: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();

  const expectedExt = osKey === 'windows' ? '.zip' : '.tar.gz';
  const needle = `${osKey}_${archKey}`;

  const asset = json.assets.find(
    (a) =>
      typeof a?.name === 'string' &&
      a.name.includes(needle) &&
      a.name.startsWith('actionlint_') &&
      a.name.endsWith(expectedExt),
  );

  if (!asset?.browser_download_url || typeof asset.name !== 'string') {
    console.error(`Could not find a matching actionlint asset for ${needle} (${expectedExt}).`);
    process.exit(1);
  }

  const tmpBase = await fs.mkdtemp(join(tmpdir(), 'actionlint-'));
  const archivePath = join(tmpBase, asset.name);

  console.log(`Downloading ${asset.name}...`);
  await downloadToFile(asset.browser_download_url, archivePath);

  console.log('Extracting...');
  if (osKey === 'windows') {
    const ps = [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${tmpBase}' -Force`,
    ];
    const x = spawnSync('powershell', ps, { stdio: 'inherit' });
    if (x.status !== 0) process.exit(x.status ?? 1);
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

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
