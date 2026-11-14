// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  escapeMarkdownCell,
  isDefaultExcluded,
  loadSummary,
  parseArgs,
  rankFiles,
  renderMarkdown,
  renderTable,
  toRepoRelative,
} from './coverage-hotspots.mjs';

function metric(total, covered) {
  return { total, covered, skipped: 0, pct: total === 0 ? 100 : (100 * covered) / total };
}

function fileMetrics(linesTotal, linesCovered) {
  return {
    lines: metric(linesTotal, linesCovered),
    functions: metric(10, 8),
    branches: metric(10, 5),
    statements: metric(linesTotal, linesCovered),
  };
}

describe('coverage-hotspots', () => {
  it('excludes untestable entrypoints and vendor by default', () => {
    expect(isDefaultExcluded('src/main/index.ts')).toBe(true);
    expect(isDefaultExcluded('src/preload/index.ts')).toBe(true);
    expect(isDefaultExcluded('src/main/translation/vendor/bergamot.js')).toBe(true);
    expect(isDefaultExcluded('src/renderer/lib/foo.d.ts')).toBe(true);
    expect(isDefaultExcluded('src/renderer/runtime/useMeshcoreRuntime.ts')).toBe(false);
    expect(isDefaultExcluded('src/main/index.ts', { includeUntestable: true })).toBe(false);
  });

  it('ranks by uncovered lines then path', () => {
    const summary = loadSummary({
      total: fileMetrics(1000, 700),
      'src/a.ts': fileMetrics(200, 100),
      'src/b.ts': fileMetrics(200, 50),
      'src/c.ts': fileMetrics(50, 0),
      'src/main/index.ts': fileMetrics(3000, 0),
      'src/main/translation/vendor/x.js': fileMetrics(500, 0),
    });
    const ranked = rankFiles(summary.files, { top: 10, minLines: 100 });
    expect(ranked.map((r) => r.file)).toEqual(['src/b.ts', 'src/a.ts']);
    expect(ranked[0].uncoveredLines).toBe(150);
  });

  it('filters by --dir and --min-lines', () => {
    const summary = loadSummary({
      total: fileMetrics(1000, 700),
      'src/main/mqtt-manager.ts': fileMetrics(200, 100),
      'src/renderer/App.tsx': fileMetrics(200, 50),
      'src/main/tiny.ts': fileMetrics(20, 0),
    });
    const ranked = rankFiles(summary.files, {
      top: 10,
      minLines: 100,
      dir: 'src/main/',
    });
    expect(ranked.map((r) => r.file)).toEqual(['src/main/mqtt-manager.ts']);
  });

  it('matches absolute coverage keys against a repo-relative --dir', () => {
    const cwd = process.cwd().replaceAll('\\', '/');
    const absoluteMain = `${cwd}/src/main/mqtt-manager.ts`;
    const summary = loadSummary({
      total: fileMetrics(1000, 700),
      [absoluteMain]: fileMetrics(200, 100),
      [`${cwd}/src/renderer/App.tsx`]: fileMetrics(200, 50),
    });
    const ranked = rankFiles(summary.files, {
      top: 10,
      minLines: 100,
      dir: 'src/main/',
    });
    expect(ranked.map((r) => toRepoRelative(r.file))).toEqual(['src/main/mqtt-manager.ts']);
    expect(ranked.map((r) => r.file)).toEqual([absoluteMain]);
  });

  it('renders a plain table and escapes markdown file cells', () => {
    const rows = rankFiles(
      loadSummary({
        total: fileMetrics(100, 50),
        'src/a|b.ts': fileMetrics(100, 40),
      }).files,
      { top: 5, minLines: 1 },
    );
    const table = renderTable(rows);
    expect(table).toContain('uncovered');
    expect(table).toContain('src/a|b.ts');
    expect(escapeMarkdownCell('a|b')).toBe('a\\|b');
    const md = renderMarkdown(
      {
        lines: metric(100, 50),
        functions: metric(10, 8),
        branches: metric(10, 6),
        statements: metric(100, 50),
      },
      rows,
    );
    expect(md).toContain('Lines 50.0%');
    expect(md).toContain('| src/a\\|b.ts |');
  });

  it('rejects malformed summaries', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'coverage-hotspots-'));
    writeFileSync(
      path.join(dir, 'bad.json'),
      JSON.stringify({ total: fileMetrics(1, 1), 'src/x.ts': { lines: { total: 1 } } }),
    );
    expect(() => loadSummary(null)).toThrow(/Malformed/);
    expect(() => loadSummary(JSON.parse(readFileSync(path.join(dir, 'bad.json'), 'utf8')))).toThrow(
      /Malformed/,
    );
  });

  it('parses CLI flags', () => {
    const opts = parseArgs([
      '--top',
      '5',
      '--min-lines',
      '10',
      '--dir',
      'src/main/',
      '--json',
      '--md',
      '--include-untestable',
      '--summary',
      '/tmp/x.json',
    ]);
    expect(opts.top).toBe(5);
    expect(opts.minLines).toBe(10);
    expect(opts.dir).toBe('src/main/');
    expect(opts.json).toBe(true);
    expect(opts.md).toBe(true);
    expect(opts.includeUntestable).toBe(true);
    expect(opts.summaryPath).toBe('/tmp/x.json');
  });

  it('rejects missing operands and invalid numeric ranges', () => {
    expect(() => parseArgs(['--top'])).toThrow(/Missing value for --top/);
    expect(() => parseArgs(['--top', '--json'])).toThrow(/Missing value for --top/);
    expect(() => parseArgs(['--top', '0'])).toThrow(/Invalid value for --top/);
    expect(() => parseArgs(['--top', '1.5'])).toThrow(/Invalid value for --top/);
    expect(() => parseArgs(['--top', 'nope'])).toThrow(/Invalid value for --top/);
    expect(() => parseArgs(['--min-lines'])).toThrow(/Missing value for --min-lines/);
    expect(() => parseArgs(['--min-lines', '-1'])).toThrow(/Invalid value for --min-lines/);
    expect(() => parseArgs(['--dir'])).toThrow(/Missing value for --dir/);
    expect(() => parseArgs(['--dir', '--json'])).toThrow(/Missing value for --dir/);
  });
});
