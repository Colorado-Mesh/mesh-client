import { describe, expect, it } from 'vitest';

import {
  githubApiHeaders,
  normalizeArch,
  normalizeOs,
  pickActionlintAsset,
  PINNED_ACTIONLINT_VERSION,
  pinnedActionlintAsset,
} from './install-actionlint.mjs';

describe('install-actionlint', () => {
  it('pins a concrete actionlint version for API rate-limit fallback', () => {
    expect(PINNED_ACTIONLINT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('builds githubApiHeaders with Bearer token when GITHUB_TOKEN is set', () => {
    const headers = githubApiHeaders({ GITHUB_TOKEN: ' ghp_test ' });
    expect(headers.Authorization).toBe('Bearer ghp_test');
    expect(headers['User-Agent']).toBe('mesh-client');
  });

  it('omits Authorization when no token is present', () => {
    const headers = githubApiHeaders({});
    expect(headers.Authorization).toBeUndefined();
  });

  it('normalizes platform/arch keys used in release asset names', () => {
    expect(normalizeOs('linux')).toBe('linux');
    expect(normalizeOs('darwin')).toBe('darwin');
    expect(normalizeOs('win32')).toBe('windows');
    expect(normalizeArch('x64')).toBe('amd64');
    expect(normalizeArch('arm64')).toBe('arm64');
  });

  it('constructs pinned download URLs without calling the Releases API', () => {
    const asset = pinnedActionlintAsset('linux', 'amd64');
    expect(asset.name).toBe(`actionlint_${PINNED_ACTIONLINT_VERSION}_linux_amd64.tar.gz`);
    expect(asset.browser_download_url).toBe(
      `https://github.com/rhysd/actionlint/releases/download/v${PINNED_ACTIONLINT_VERSION}/${asset.name}`,
    );
  });

  it('picks the matching asset from a releases/latest payload', () => {
    const asset = pickActionlintAsset(
      [
        {
          name: `actionlint_${PINNED_ACTIONLINT_VERSION}_linux_amd64.tar.gz`,
          browser_download_url: 'https://example.test/linux.tar.gz',
        },
        {
          name: `actionlint_${PINNED_ACTIONLINT_VERSION}_darwin_arm64.tar.gz`,
          browser_download_url: 'https://example.test/darwin.tar.gz',
        },
      ],
      'darwin',
      'arm64',
    );
    expect(asset).toEqual({
      name: `actionlint_${PINNED_ACTIONLINT_VERSION}_darwin_arm64.tar.gz`,
      browser_download_url: 'https://example.test/darwin.tar.gz',
    });
  });
});
