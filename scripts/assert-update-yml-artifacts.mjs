#!/usr/bin/env node
/**
 * Fail closed when electron-updater channel files (latest.yml / latest-mac.yml /
 * latest-linux.yml / latest-linux-arm64.yml) point at names that are not on disk
 * or that contain spaces (GitHub's upload API rewrites spaces to dots).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const UPDATE_YML_CHANNEL_FILES = Object.freeze([
  'latest.yml',
  'latest-mac.yml',
  'latest-linux.yml',
  'latest-linux-arm64.yml',
]);

/**
 * @param {string} raw
 * @returns {string}
 */
function unquoteYamlScalar(raw) {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Minimal electron-updater channel-file parser (no general YAML dependency).
 *
 * @param {string} text
 * @returns {{ urls: string[], path: string | null }}
 */
export function parseElectronUpdateYml(text) {
  if (typeof text !== 'string') {
    throw new Error('update yml text must be a string');
  }
  /** @type {string[]} */
  const urls = [];
  /** @type {string | null} */
  let pathField = null;
  for (const line of text.split(/\r?\n/)) {
    const urlMatch = /^\s*-?\s*url:\s*(.+)$/.exec(line);
    if (urlMatch) {
      urls.push(unquoteYamlScalar(urlMatch[1]));
      continue;
    }
    const pathMatch = /^path:\s*(.+)$/.exec(line);
    if (pathMatch) {
      pathField = unquoteYamlScalar(pathMatch[1]);
    }
  }
  if (pathField && !urls.includes(pathField)) {
    urls.push(pathField);
  }
  return { urls, path: pathField };
}

/**
 * @param {string} name
 * @returns {string}
 */
export function stripInstallerRunStamp(name) {
  return name.replace(/-run\d+/g, '');
}

/**
 * @param {string} rootDir
 * @returns {string[]}
 */
export function collectReleaseBasenames(rootDir) {
  if (!fs.existsSync(rootDir)) {
    throw new Error(`Missing directory: ${rootDir}`);
  }
  /** @type {string[]} */
  const out = [];

  /**
   * @param {string} current
   */
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile()) out.push(entry.name);
    }
  }

  walk(rootDir);
  return out;
}

/**
 * @param {string} url
 * @param {string[]} basenames
 * @returns {string | null}
 */
export function findDiskMatchForYmlUrl(url, basenames) {
  for (const name of basenames) {
    if (name === url || stripInstallerRunStamp(name) === url) {
      return name;
    }
  }
  return null;
}

/**
 * @param {{
 *   ymlByName: Record<string, string>
 *   basenames: string[]
 *   requiredFiles?: string[]
 * }} opts
 * @returns {{ checked: string[], matched: Array<{ yml: string, url: string, disk: string }> }}
 */
export function assertUpdateYmlUrlsMatchBasenames(opts) {
  const required = opts.requiredFiles ?? [];
  for (const name of required) {
    if (!(name in opts.ymlByName)) {
      throw new Error(`Missing required update channel file: ${name}`);
    }
  }
  const ymlNames = Object.keys(opts.ymlByName);
  if (ymlNames.length === 0) {
    throw new Error(
      `No update channel files found (expected one of ${UPDATE_YML_CHANNEL_FILES.join(', ')})`,
    );
  }

  /** @type {Array<{ yml: string, url: string, disk: string }>} */
  const matched = [];
  for (const ymlName of ymlNames) {
    const parsed = parseElectronUpdateYml(opts.ymlByName[ymlName]);
    if (parsed.urls.length === 0) {
      throw new Error(`${ymlName} has no files[].url or path entries`);
    }
    for (const url of parsed.urls) {
      if (url.includes(' ')) {
        throw new Error(
          `${ymlName} url ${JSON.stringify(url)} contains spaces — GitHub rewrites spaces to dots and electron-updater 404s`,
        );
      }
      // packaging-smoke artifacts omit *.blockmap; verify those on the GitHub release feed.
      if (url.endsWith('.blockmap')) continue;
      const disk = findDiskMatchForYmlUrl(url, opts.basenames);
      if (!disk) {
        throw new Error(
          `${ymlName} url ${JSON.stringify(url)} is not present under the release directory (found: ${opts.basenames.join(', ') || '(none)'})`,
        );
      }
      matched.push({ yml: ymlName, url, disk });
    }
  }
  return { checked: ymlNames, matched };
}

/**
 * Read a UTF-8 file if present. Avoid existsSync→stat→read TOCTOU (CodeQL js/file-system-race).
 * @param {string} filePath
 * @returns {string | null}
 */
function readUtf8FileIfPresent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const code =
      err && typeof err === 'object' ? /** @type {{ code?: unknown }} */ (err).code : undefined;
    if (code === 'ENOENT' || code === 'EISDIR') {
      // catch-no-log-ok optional channel file missing or is a directory
      return null;
    }
    throw err;
  }
}

/**
 * @param {{ rootDir: string, requiredFiles?: string[] }} opts
 */
export function assertUpdateYmlArtifacts(opts) {
  /** @type {Record<string, string>} */
  const ymlByName = {};
  for (const name of UPDATE_YML_CHANNEL_FILES) {
    const text = readUtf8FileIfPresent(path.join(opts.rootDir, name));
    if (text != null) {
      ymlByName[name] = text;
    }
  }
  return assertUpdateYmlUrlsMatchBasenames({
    ymlByName,
    basenames: collectReleaseBasenames(opts.rootDir),
    requiredFiles: opts.requiredFiles,
  });
}

/**
 * @param {string[]} argv
 * @returns {{ rootDir: string, requiredFiles: string[] }}
 */
export function parseAssertUpdateYmlArgs(argv) {
  let rootDir = path.join(ROOT, 'release');
  /** @type {string[]} */
  const requiredFiles = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      const next = argv[++i];
      if (!next) throw new Error('--root requires a directory');
      rootDir = path.resolve(next);
    } else if (arg === '--require') {
      const next = argv[++i];
      if (!next) throw new Error('--require requires a channel filename');
      if (!UPDATE_YML_CHANNEL_FILES.includes(next)) {
        throw new Error(`Unknown channel file: ${next}`);
      }
      requiredFiles.push(next);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { rootDir, requiredFiles };
}

function main() {
  const { rootDir, requiredFiles } = parseAssertUpdateYmlArgs(process.argv.slice(2));
  const result = assertUpdateYmlArtifacts({
    rootDir,
    requiredFiles: requiredFiles.length > 0 ? requiredFiles : undefined,
  });
  console.debug(
    `[assert-update-yml-artifacts] OK — ${result.checked.join(', ')} (${result.matched.length} url(s))`,
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
