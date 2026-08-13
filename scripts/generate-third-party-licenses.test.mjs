// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildThirdPartyLicensesMarkdown } from './generate-third-party-licenses.mjs';

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
