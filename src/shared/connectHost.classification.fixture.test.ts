// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isLocalConnectHost } from './connectHost';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/localConnectHostClassification.json',
);

interface LocalConnectHostFixture {
  local: string[];
  remote: string[];
}

describe('isLocalConnectHost shared fixture', () => {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as LocalConnectHostFixture;

  it.each(fixture.local)('treats %s as local', (host) => {
    expect(isLocalConnectHost(host)).toBe(true);
  });

  it.each(fixture.remote)('treats %s as remote', (host) => {
    expect(isLocalConnectHost(host)).toBe(false);
  });
});
