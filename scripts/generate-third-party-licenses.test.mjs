// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildThirdPartyLicensesMarkdown,
  generateThirdPartyLicenses,
} from './generate-third-party-licenses.mjs';

describe('buildThirdPartyLicensesMarkdown', () => {
  it('wraps prod and dev tables with a generated-file header', () => {
    const markdown = buildThirdPartyLicensesMarkdown({
      prodTable: '| name | license type |\n| --- | --- |\n| react | MIT |\n',
      devTable: '| name | license type |\n| --- | --- |\n| vitest | MIT |\n',
    });
    expect(markdown).toMatch(/^# Third-party licenses\n/);
    expect(markdown).toMatch(/Do not edit by hand/);
    expect(markdown).toMatch(/## Runtime dependencies/);
    expect(markdown).toMatch(/## Development dependencies/);
    expect(markdown).toMatch(/credits\.md/);
    expect(markdown).toMatch(/\| react \| MIT \|/);
    expect(markdown).toMatch(/\| vitest \| MIT \|/);
  });
});

describe('generateThirdPartyLicenses failures', () => {
  /** @type {string[]} */
  const dirs = [];

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  function makeExistingTarget() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-licenses-gen-'));
    dirs.push(dir);
    const targetPath = path.join(dir, 'third-party-licenses.md');
    const original = '# existing licenses\n';
    fs.writeFileSync(targetPath, original);
    return { targetPath, original };
  }

  it('returns 1 and leaves the target unchanged when license check fails', () => {
    const { targetPath, original } = makeExistingTarget();
    const code = generateThirdPartyLicenses({
      targetPath,
      checkLicenses: () => {
        throw new Error('check failed');
      },
      loadReportTables: () => ({ prodTable: '| a |', devTable: '| b |' }),
      formatMarkdownFile: () => {},
    });
    expect(code).toBe(1);
    expect(fs.readFileSync(targetPath, 'utf8')).toBe(original);
  });

  it('returns 1 and leaves the target unchanged when report generation fails', () => {
    const { targetPath, original } = makeExistingTarget();
    const code = generateThirdPartyLicenses({
      targetPath,
      checkLicenses: () => {},
      loadReportTables: () => {
        throw new Error('report failed');
      },
      formatMarkdownFile: () => {},
    });
    expect(code).toBe(1);
    expect(fs.readFileSync(targetPath, 'utf8')).toBe(original);
  });

  it('returns 1 and leaves the target unchanged when formatting fails', () => {
    const { targetPath, original } = makeExistingTarget();
    const code = generateThirdPartyLicenses({
      targetPath,
      checkLicenses: () => {},
      loadReportTables: () => ({ prodTable: '| a |', devTable: '| b |' }),
      formatMarkdownFile: () => {
        throw new Error('format failed');
      },
    });
    expect(code).toBe(1);
    expect(fs.readFileSync(targetPath, 'utf8')).toBe(original);
  });
});
