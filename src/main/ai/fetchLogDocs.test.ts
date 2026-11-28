// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearLogDocsCacheForTests,
  fetchLogDocsForAnalysis,
  LogDocsUnavailableError,
} from './fetchLogDocs';

afterEach(() => {
  clearLogDocsCacheForTests();
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe('fetchLogDocsForAnalysis', () => {
  it('selects sections from allowlisted markdown', async () => {
    const markdown = `## BLE connection\n\nCheck pairing.\n\n## Other\n\nNope.\n`;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      expect(requestUrl(input)).toContain(
        'raw.githubusercontent.com/Colorado-Mesh/mesh-client/main/docs/',
      );
      return Promise.resolve(new Response(markdown, { status: 200 }));
    });
    const result = await fetchLogDocsForAnalysis('meshtastic', ['ble-connection'], 50_000, {
      fetch: fetchImpl as unknown as typeof fetch,
      isOnline: () => true,
    });
    expect(result.docsUrl).toContain('/troubleshooting/');
    expect(result.docsText).toContain('BLE connection');
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('fails closed when offline', async () => {
    await expect(
      fetchLogDocsForAnalysis('meshcore', ['mqtt'], 10_000, {
        fetch: vi.fn() as unknown as typeof fetch,
        isOnline: () => false,
      }),
    ).rejects.toBeInstanceOf(LogDocsUnavailableError);
  });

  it('fails closed on non-allowlisted redirects via fetch error', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('redirect')));
    await expect(
      fetchLogDocsForAnalysis('reticulum', ['sidecar'], 10_000, {
        fetch: fetchImpl as unknown as typeof fetch,
        isOnline: () => true,
      }),
    ).rejects.toBeInstanceOf(LogDocsUnavailableError);
  });
});
