#!/usr/bin/env node
/**
 * Rank files by uncovered lines from Vitest's coverage-summary.json.
 * Run `pnpm run test:coverage` first (writes coverage/coverage-summary.json).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_SUMMARY = path.join(process.cwd(), 'coverage', 'coverage-summary.json');
const DEFAULT_TOP = 20;
const DEFAULT_MIN_LINES = 100;

const ALWAYS_EXCLUDE = new Set(['total']);

/**
 * Normalize coverage keys and `--dir` filters to repo-relative POSIX paths so absolute
 * keys from V8 still match repository-relative prefixes.
 * @param {string} filePath
 * @param {string} [cwd]
 */
export function toRepoRelative(filePath, cwd = process.cwd()) {
  const normalized = filePath.replaceAll('\\', '/');
  const root = cwd.replaceAll('\\', '/').replace(/\/$/, '');
  if (normalized === root) return '';
  if (normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1);
  return normalized.replace(/^\.\//, '');
}

/**
 * @param {string} filePath
 * @param {{ includeUntestable?: boolean }} [opts]
 */
export function isDefaultExcluded(filePath, opts = {}) {
  if (opts.includeUntestable) return false;
  const normalized = toRepoRelative(filePath);
  if (normalized === 'src/main/index.ts' || normalized.endsWith('/src/main/index.ts')) return true;
  if (normalized === 'src/preload/index.ts' || normalized.endsWith('/src/preload/index.ts'))
    return true;
  if (normalized.includes('/vendor/')) return true;
  if (normalized.endsWith('.d.ts')) return true;
  return false;
}

/**
 * @param {unknown} summary
 * @returns {{ total: Record<string, { total: number; covered: number; pct: number }>; files: Array<{ file: string; lines: { total: number; covered: number; pct: number }; functions: { total: number; covered: number; pct: number }; branches: { total: number; covered: number; pct: number }; statements: { total: number; covered: number; pct: number }; uncoveredLines: number }> }}
 */
export function loadSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new Error('Malformed coverage summary: expected object');
  }
  const record = /** @type {Record<string, unknown>} */ (summary);
  if (!record.total || typeof record.total !== 'object') {
    throw new Error('Malformed coverage summary: missing total');
  }
  const files = [];
  for (const [file, metrics] of Object.entries(record)) {
    if (ALWAYS_EXCLUDE.has(file)) continue;
    if (!metrics || typeof metrics !== 'object') {
      throw new Error(`Malformed coverage summary: bad metrics for ${file}`);
    }
    const m = /** @type {Record<string, { total?: number; covered?: number; pct?: number }>} */ (
      metrics
    );
    for (const key of ['lines', 'functions', 'branches', 'statements']) {
      const block = m[key];
      if (
        !block ||
        typeof block.total !== 'number' ||
        typeof block.covered !== 'number' ||
        typeof block.pct !== 'number'
      ) {
        throw new Error(`Malformed coverage summary: bad ${key} for ${file}`);
      }
    }
    const lines = /** @type {{ total: number; covered: number; pct: number }} */ (m.lines);
    files.push({
      file,
      lines,
      functions: /** @type {{ total: number; covered: number; pct: number }} */ (m.functions),
      branches: /** @type {{ total: number; covered: number; pct: number }} */ (m.branches),
      statements: /** @type {{ total: number; covered: number; pct: number }} */ (m.statements),
      uncoveredLines: lines.total - lines.covered,
    });
  }
  return {
    total: /** @type {Record<string, { total: number; covered: number; pct: number }>} */ (
      record.total
    ),
    files,
  };
}

/**
 * @param {ReturnType<typeof loadSummary>['files']} files
 * @param {{ top?: number; minLines?: number; dir?: string; includeUntestable?: boolean }} [opts]
 */
export function rankFiles(files, opts = {}) {
  const top = opts.top ?? DEFAULT_TOP;
  const minLines = opts.minLines ?? DEFAULT_MIN_LINES;
  const dir = opts.dir != null ? toRepoRelative(opts.dir) : undefined;
  const filtered = files
    .filter((row) => !isDefaultExcluded(row.file, opts))
    .filter((row) => row.lines.total >= minLines)
    .filter((row) => {
      if (!dir) return true;
      return toRepoRelative(row.file).startsWith(dir);
    })
    .sort((a, b) => {
      if (b.uncoveredLines !== a.uncoveredLines) return b.uncoveredLines - a.uncoveredLines;
      return a.file.localeCompare(b.file);
    });
  return filtered.slice(0, top);
}

/**
 * @param {string} value
 */
function pad(value, width) {
  const s = String(value);
  return s.length >= width ? s : `${' '.repeat(width - s.length)}${s}`;
}

/**
 * @param {ReturnType<typeof rankFiles>} rows
 */
export function renderTable(rows) {
  const header = [
    pad('uncovered', 9),
    pad('%lines', 7),
    pad('%funcs', 7),
    pad('%branches', 10),
    pad('total', 6),
    'file',
  ].join('  ');
  const lines = [header];
  for (const row of rows) {
    lines.push(
      [
        pad(row.uncoveredLines, 9),
        pad(row.lines.pct.toFixed(1), 7),
        pad(row.functions.pct.toFixed(1), 7),
        pad(row.branches.pct.toFixed(1), 10),
        pad(row.lines.total, 6),
        row.file,
      ].join('  '),
    );
  }
  return lines.join('\n');
}

/**
 * @param {string} text
 */
export function escapeMarkdownCell(text) {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/**
 * @param {ReturnType<typeof loadSummary>['total']} total
 * @param {ReturnType<typeof rankFiles>} rows
 */
export function renderMarkdown(total, rows) {
  const headline = [
    `Lines ${total.lines.pct.toFixed(1)}% (${total.lines.covered.toLocaleString()}/${total.lines.total.toLocaleString()})`,
    `Functions ${total.functions.pct.toFixed(1)}%`,
    `Branches ${total.branches.pct.toFixed(1)}%`,
    `Statements ${total.statements.pct.toFixed(1)}%`,
  ].join(' · ');
  const lines = [
    headline,
    '',
    '| uncovered | %lines | %funcs | %branches | total | file |',
    '| ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.uncoveredLines} | ${row.lines.pct.toFixed(1)} | ${row.functions.pct.toFixed(1)} | ${row.branches.pct.toFixed(1)} | ${row.lines.total} | ${escapeMarkdownCell(row.file)} |`,
    );
  }
  return lines.join('\n');
}

/**
 * @param {string[]} argv
 */
/**
 * @param {string} flag
 * @param {string | undefined} value
 */
function requireOperand(flag, value) {
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

/**
 * @param {string} flag
 * @param {string | undefined} value
 */
function requirePositiveInt(flag, value) {
  const raw = requireOperand(flag, value);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid value for ${flag}: ${raw}`);
  }
  return n;
}

export function parseArgs(argv) {
  const opts = {
    top: DEFAULT_TOP,
    minLines: DEFAULT_MIN_LINES,
    dir: undefined,
    json: false,
    md: false,
    includeUntestable: false,
    summaryPath: DEFAULT_SUMMARY,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--top') {
      opts.top = requirePositiveInt('--top', argv[++i]);
    } else if (arg === '--min-lines') {
      opts.minLines = requirePositiveInt('--min-lines', argv[++i]);
    } else if (arg === '--dir') {
      opts.dir = requireOperand('--dir', argv[++i]);
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--md') {
      opts.md = true;
    } else if (arg === '--include-untestable') {
      opts.includeUntestable = true;
    } else if (arg === '--summary') {
      opts.summaryPath = requireOperand('--summary', argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node scripts/coverage-hotspots.mjs [options]

Options:
  --top N                 Show top N files (default ${DEFAULT_TOP})
  --min-lines N           Minimum line count to rank (default ${DEFAULT_MIN_LINES})
  --dir <prefix>          Only files under this path prefix
  --json                  Emit JSON
  --md                    Emit GitHub-flavoured markdown (for $GITHUB_STEP_SUMMARY)
  --include-untestable    Keep main/preload entrypoints and vendor bundles
  --summary <path>        Path to coverage-summary.json
`);
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  if (opts.help) {
    printHelp();
    return 0;
  }

  let raw;
  try {
    raw = readFileSync(opts.summaryPath, 'utf8');
  } catch {
    console.error('Run `pnpm run test:coverage` first.');
    return 1;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('Malformed coverage summary: invalid JSON');
    return 2;
  }

  let summary;
  try {
    summary = loadSummary(parsed);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  const ranked = rankFiles(summary.files, opts);
  if (opts.json) {
    console.log(JSON.stringify({ total: summary.total, files: ranked }, null, 2));
  } else if (opts.md) {
    console.log(renderMarkdown(summary.total, ranked));
  } else {
    console.log(renderTable(ranked));
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
