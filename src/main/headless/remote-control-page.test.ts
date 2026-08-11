// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildMissingTokenPageHtml,
  buildRemoteControlPageHtml,
  remoteHealthJson,
} from './remote-control-page';

describe('buildRemoteControlPageHtml', () => {
  it('includes a restrictive CSP with connect-src self and never embeds a token env name', () => {
    const html = buildRemoteControlPageHtml();
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src 'self'");
    expect(html).toContain("base-uri 'none'");
    expect(html).toContain("form-action 'self'");
    expect(html).toContain("frame-ancestors 'none'");
    expect(html).not.toContain('MESH_CLIENT_REMOTE_TOKEN');
    expect(html).not.toContain('showTokenPrompt');
    expect(html).not.toContain('token-form');
  });
});

describe('buildMissingTokenPageHtml', () => {
  it('serves a GET form to / without script-src', () => {
    const html = buildMissingTokenPageHtml();
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/"');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain('script-src');
    expect(html).toContain('aria-label="Access token"');
  });
});

describe('remoteHealthJson', () => {
  it('serializes the health probe contract', () => {
    expect(JSON.parse(remoteHealthJson(true, false, 12))).toEqual({
      ok: true,
      ready: true,
      rendererLoaded: false,
      uptimeSec: 12,
    });
  });
});
