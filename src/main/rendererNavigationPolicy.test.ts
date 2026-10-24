// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  isAllowedRendererDeviceOrigin,
  isAllowedRendererNavigation,
  isAllowedRendererPermission,
} from './rendererNavigationPolicy';

describe('renderer navigation policy', () => {
  it.each([
    ['mesh-client://renderer/index.html', 'mesh-client://renderer/index.html#settings'],
    ['mesh-client://renderer/index.html', 'mesh-client://renderer/migration.html'],
    ['file:///app/renderer/index.html', 'file:///app/renderer/index.html#settings'],
    ['file:///C:/App/renderer/index.html', 'file:///C:/App/renderer/index.html?reload=1'],
    ['http://localhost:5173/', 'http://localhost:5173/settings'],
    ['https://127.0.0.1:5173/', 'https://127.0.0.1:5173/'],
  ])('allows navigation from %s to %s', (renderer, target) => {
    expect(isAllowedRendererNavigation(renderer, target)).toBe(true);
  });

  it.each([
    ['mesh-client://renderer/index.html', 'mesh-client://evil/index.html'],
    ['mesh-client://renderer/index.html', 'mesh-client://renderer:123/index.html'],
    ['mesh-client://renderer/index.html', 'mesh-client://user@renderer/index.html'],
    ['mesh-client://renderer/index.html', 'mesh-client://renderer.evil/index.html'],
    ['mesh-client://renderer/index.html', 'file:///app/renderer/index.html'],
    ['mesh-client://evil/index.html', 'mesh-client://evil/'],
    ['file:///app/renderer/index.html', 'file:///app/private.html'],
    ['file:///C:/App/renderer/index.html', 'file:///C:/App/other/index.html'],
    ['file:///app/renderer/index.html', 'file://remote/app/renderer/index.html'],
    ['file:///app/renderer/index.html', 'mesh-client://renderer/index.html'],
    ['http://localhost:5173/', 'http://localhost:5174/'],
    ['http://localhost:5173/', 'http://127.0.0.1:5173/'],
    ['http://localhost:5173/', 'https://localhost:5173/'],
    ['http://localhost:5173/', 'http://user:secret@localhost:5173/'],
    ['http://localhost:5173/', 'http://localhost.evil:5173/'],
    ['mesh-client://renderer/index.html', 'https://example.com/'],
    ['mesh-client://renderer/index.html', 'javascript:alert(1)'],
    ['mesh-client://renderer/index.html', 'data:text/html,<script></script>'],
    ['mesh-client://renderer/index.html', 'lxm://untrusted'],
    ['mesh-client://renderer/index.html', 'not a url'],
    ['not a url', 'mesh-client://renderer/index.html'],
  ])('rejects navigation from %s to %s', (renderer, target) => {
    expect(isAllowedRendererNavigation(renderer, target)).toBe(false);
  });
});

describe('renderer permission policy', () => {
  const context = {
    rendererUrl: 'mesh-client://renderer/index.html',
    requestingUrl: 'mesh-client://renderer/index.html',
    requestingOrigin: 'mesh-client://renderer',
    isMainFrame: true,
    sameWebContents: true,
  };

  it('requires the trusted main frame even for a matching origin', () => {
    expect(isAllowedRendererPermission(context)).toBe(true);
    expect(isAllowedRendererPermission({ ...context, sameWebContents: false })).toBe(false);
    expect(isAllowedRendererPermission({ ...context, isMainFrame: false })).toBe(false);
    expect(isAllowedRendererPermission({ ...context, requestingUrl: undefined })).toBe(false);
    expect(
      isAllowedRendererPermission({ ...context, requestingUrl: 'https://evil.example/' }),
    ).toBe(false);
    expect(
      isAllowedRendererPermission({ ...context, requestingOrigin: 'mesh-client://evil' }),
    ).toBe(false);
  });

  it('supports permission requests with a full URL and no separate origin', () => {
    expect(isAllowedRendererPermission({ ...context, requestingOrigin: undefined })).toBe(true);
  });

  it('checks the exact document when the legacy file origin lacks a path', () => {
    const fileContext = {
      ...context,
      rendererUrl: 'file:///app/renderer/index.html',
      requestingUrl: 'file:///app/renderer/index.html',
      requestingOrigin: 'file://',
    };
    expect(isAllowedRendererPermission(fileContext)).toBe(true);
    expect(
      isAllowedRendererPermission({ ...fileContext, requestingUrl: 'file:///tmp/untrusted.html' }),
    ).toBe(false);
    expect(isAllowedRendererPermission({ ...fileContext, requestingUrl: undefined })).toBe(false);
    expect(isAllowedRendererPermission({ ...fileContext, requestingOrigin: 'null' })).toBe(false);
  });

  it.each([
    ['mesh-client://renderer/index.html', 'mesh-client://renderer', true],
    ['mesh-client://renderer/index.html', 'mesh-client://evil', false],
    ['mesh-client://renderer/index.html', 'mesh-client://renderer:123', false],
    ['mesh-client://renderer/index.html', 'mesh-client://user@renderer', false],
    ['mesh-client://renderer/index.html', 'mesh-client://renderer/index.html', false],
    ['file:///app/renderer/index.html', 'file://', true],
    ['file:///app/renderer/index.html', 'file://remote', false],
    ['file:///app/renderer/index.html', 'file:///tmp/untrusted.html', false],
    ['file:///app/renderer/index.html', 'null', false],
    ['http://localhost:5173/', 'http://localhost:5173', true],
    ['http://localhost:5173/', 'http://localhost:5174', false],
    ['http://localhost:5173/', 'http://localhost:5173?key=value', false],
    ['http://localhost:5173/', 'http://localhost:5173#fragment', false],
  ])('validates device origin %s / %s', (renderer, origin, expected) => {
    expect(isAllowedRendererDeviceOrigin(renderer, origin)).toBe(expected);
  });
});
