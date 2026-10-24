// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRendererOriginProtocolHandler } from './rendererOriginProtocol';

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));

describe('renderer origin protocol', () => {
  let temporary: string;
  let distRoot: string;
  const fetchImpl = vi.fn(async (url: string) => new Response(await readFile(fileURLToPath(url))));

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(tmpdir(), 'mesh-renderer-protocol-'));
    distRoot = path.join(temporary, 'renderer');
    await mkdir(distRoot);
    fetchImpl.mockClear();
  });

  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function expectIsolationHeaders(response: Response): void {
    expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('credentialless');
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  }

  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['migration.html', 'text/html; charset=utf-8'],
    ['app.js', 'text/javascript; charset=utf-8'],
    ['worker.mjs', 'text/javascript; charset=utf-8'],
    ['app.css', 'text/css; charset=utf-8'],
    ['runtime.wasm', 'application/wasm'],
    ['font.woff2', 'font/woff2'],
    ['asset.bin', 'application/octet-stream'],
  ])('serves %s with its MIME type and isolation headers', async (name, mime) => {
    await writeFile(path.join(distRoot, name), 'asset bytes');
    const handler = createRendererOriginProtocolHandler({ distRoot, fetchImpl });
    const response = await handler(new Request(`mesh-client://renderer/${name}?v=1`));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('asset bytes');
    expect(response.headers.get('Content-Type')).toBe(mime);
    expect(response.headers.get('Cache-Control')).toBe(
      name.endsWith('.html') ? 'no-store' : 'no-cache',
    );
    expectIsolationHeaders(response);
  });

  it('maps the origin root to index.html and serves HEAD without a body', async () => {
    await writeFile(path.join(distRoot, 'index.html'), '<html></html>');
    const handler = createRendererOriginProtocolHandler({ distRoot, fetchImpl });
    const response = await handler(new Request('mesh-client://renderer/'));
    expect(await response.text()).toBe('<html></html>');
    const head = await handler(new Request('mesh-client://renderer/', { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expectIsolationHeaders(head);
  });

  it.each([
    'mesh-client://other/index.html',
    'mesh-client://renderer:123/index.html',
    'https://renderer/index.html',
    'mesh-client://renderer/%2e%2e%2fsecret.txt',
    'mesh-client://renderer/%2e%2e%5csecret.txt',
    'mesh-client://renderer/%2F..%2Fsecret.txt',
    'mesh-client://renderer/%5csecret.txt',
    'mesh-client://renderer/%00',
    'mesh-client://renderer/%zz',
    'mesh-client://renderer/missing.js',
  ])('rejects unavailable or unsafe asset URL %s with isolation headers', async (url) => {
    await writeFile(path.join(distRoot, 'index.html'), '<html></html>');
    await writeFile(path.join(temporary, 'secret.txt'), 'private');
    const handler = createRendererOriginProtocolHandler({ distRoot, fetchImpl });
    const response = await handler(new Request(url));
    expect(response.status).toBe(404);
    expectIsolationHeaders(response);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects credentials in an incoming URL', async () => {
    const handler = createRendererOriginProtocolHandler({ distRoot, fetchImpl });
    // Request disallows credentials; Electron can supply its request object directly.
    const response = await handler({
      url: 'mesh-client://user:pass@renderer/index.html',
      method: 'GET',
    } as Request);
    expect(response.status).toBe(404);
    expectIsolationHeaders(response);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a symlink to a file or directory outside the renderer root', async () => {
    await writeFile(path.join(temporary, 'secret.txt'), 'private');
    await symlink(path.join(temporary, 'secret.txt'), path.join(distRoot, 'secret.txt'), 'file');
    await symlink(temporary, path.join(distRoot, 'outside'), 'junction');
    const handler = createRendererOriginProtocolHandler({ distRoot, fetchImpl });
    for (const asset of ['secret.txt', 'outside/secret.txt']) {
      const response = await handler(new Request(`mesh-client://renderer/${asset}`));
      expect(response.status).toBe(404);
      expectIsolationHeaders(response);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not serve directories or unsupported request methods', async () => {
    await mkdir(path.join(distRoot, 'assets'));
    const handler = createRendererOriginProtocolHandler({ distRoot, fetchImpl });
    expect((await handler(new Request('mesh-client://renderer/assets'))).status).toBe(404);
    const response = await handler(new Request('mesh-client://renderer/', { method: 'POST' }));
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expectIsolationHeaders(response);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps isolation headers when the file fetch fails', async () => {
    await writeFile(path.join(distRoot, 'index.html'), '<html></html>');
    const handler = createRendererOriginProtocolHandler({
      distRoot,
      fetchImpl: vi.fn().mockRejectedValue(new Error('file unavailable')),
    });
    const response = await handler(new Request('mesh-client://renderer/'));
    expect(response.status).toBe(404);
    expectIsolationHeaders(response);
  });
});
