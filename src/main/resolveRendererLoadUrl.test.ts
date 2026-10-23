import { describe, expect, it } from 'vitest';

import {
  ENV_FORCE_FILE_ORIGIN,
  ENV_SKIP_ORIGIN_MIGRATION,
  ENV_USE_CUSTOM_PROTOCOL,
  RENDERER_INDEX_URL,
} from '../shared/rendererOrigin';
import { normalizeDevServerUrl, resolveRendererLoadUrl } from './resolveRendererLoadUrl';

describe('normalizeDevServerUrl', () => {
  it.each([
    'http://localhost:5173',
    'https://localhost:5173',
    'file:///e2e/index.html',
    'not-a-url',
  ])('preserves the external override %s', (url) => {
    expect(normalizeDevServerUrl(url)).toBe(url);
  });
});

describe('resolveRendererLoadUrl', () => {
  it.each([true, false, undefined])(
    'loads the built renderer with migrationCompleted=%s',
    (migrationCompleted) => {
      const result = resolveRendererLoadUrl({
        distIndexPath: '/dist/renderer/index.html',
        customProtocolUrl: RENDERER_INDEX_URL,
        migrationCompleted,
        env: {},
      });
      expect(result.source).toBe(migrationCompleted ? 'custom-protocol' : 'dist');
      expect(result.url.startsWith(migrationCompleted ? 'mesh-client:' : 'file:')).toBe(true);
      expect(result.openDevTools).toBe(false);
    },
  );

  it.each([
    RENDERER_INDEX_URL,
    'mesh-client://renderer/',
    'mesh-client://renderer/index.html?test=1#settings',
    'MESH-CLIENT://renderer/index.html',
    'mesh-client://other-host/index.html',
    'mesh-client://user@renderer:123/index.html',
  ])('requires verified built-renderer startup for the explicit custom URL %s', (devServerUrl) => {
    for (const migrationCompleted of [true, false, undefined]) {
      const result = resolveRendererLoadUrl({
        devServerUrl,
        distIndexPath: '/dist/renderer/index.html',
        customProtocolUrl: RENDERER_INDEX_URL,
        migrationCompleted,
        env: {},
      });
      if (migrationCompleted) {
        expect(result).toEqual({
          url: RENDERER_INDEX_URL,
          source: 'custom-protocol',
          openDevTools: false,
        });
      } else {
        expect(result.source).toBe('dist');
        expect(result.url).toMatch(/^file:/);
        expect(result.openDevTools).toBe(false);
      }
    }
  });

  it.each([ENV_FORCE_FILE_ORIGIN, ENV_SKIP_ORIGIN_MIGRATION])(
    '%s retains file storage even with completion and custom/development overrides',
    (flag) => {
      const result = resolveRendererLoadUrl({
        distIndexPath: '/dist/renderer/index.html',
        customProtocolUrl: RENDERER_INDEX_URL,
        migrationCompleted: true,
        devServerUrl: 'http://localhost:5173',
        env: { [flag]: '1', [ENV_USE_CUSTOM_PROTOCOL]: '1' },
      });
      expect(result.source).toBe('dist');
      expect(result.url).toMatch(/^file:/);
      expect(result.openDevTools).toBe(false);
    },
  );

  it.each([false, undefined])(
    'does not let the old development COI flag bypass migrationCompleted=%s',
    (migrationCompleted) => {
      const result = resolveRendererLoadUrl({
        distIndexPath: '/dist/renderer/index.html',
        customProtocolUrl: RENDERER_INDEX_URL,
        migrationCompleted,
        env: { [ENV_USE_CUSTOM_PROTOCOL]: '1' },
      });
      expect(result.source).toBe('dist');
    },
  );

  it('keeps an explicit Vite URL even after the built renderer has migrated', () => {
    const result = resolveRendererLoadUrl({
      devServerUrl: 'http://localhost:9999',
      distIndexPath: '/dist/renderer/index.html',
      customProtocolUrl: RENDERER_INDEX_URL,
      migrationCompleted: true,
      env: { [ENV_USE_CUSTOM_PROTOCOL]: '1' },
    });
    expect(result).toEqual({
      url: 'http://localhost:9999',
      openDevTools: true,
      source: 'env',
    });
  });

  it.each([
    ['linux', 'file:///home/runner/mesh-client/dist/renderer/index.html'],
    ['darwin', 'file:///Users/runner/mesh-client/dist/renderer/index.html'],
    ['win32', 'file:///D:/a/mesh-client/dist/renderer/index.html'],
    ['linux', 'FILE:///home/runner/mesh-client/dist/renderer/index.html'],
    ['darwin', 'FILE:///Users/runner/mesh-client/dist/renderer/index.html'],
    ['win32', 'FILE:///D:/a/mesh-client/dist/renderer/index.html'],
    ['linux', 'FiLe:///home/runner/mesh-client/dist/renderer/index.html'],
  ])('preserves an explicit E2E file URL without DevTools on %s', (_platform, url) => {
    const result = resolveRendererLoadUrl({
      devServerUrl: url,
      distIndexPath: '/unused/index.html',
      customProtocolUrl: RENDERER_INDEX_URL,
      migrationCompleted: true,
      env: { [ENV_USE_CUSTOM_PROTOCOL]: '1' },
    });
    expect(result).toEqual({ url, openDevTools: false, source: 'env' });
  });

  it('treats an empty dev-server override as a built renderer launch', () => {
    const result = resolveRendererLoadUrl({
      devServerUrl: '',
      distIndexPath: '/dist/renderer/index.html',
      customProtocolUrl: RENDERER_INDEX_URL,
      migrationCompleted: true,
      env: {},
    });
    expect(result).toEqual({
      url: RENDERER_INDEX_URL,
      source: 'custom-protocol',
      openDevTools: false,
    });
  });

  it('retains file loading when no custom-protocol target is supplied', () => {
    const result = resolveRendererLoadUrl({
      distIndexPath: '/dist/renderer/index.html',
      migrationCompleted: true,
      env: {},
    });
    expect(result.source).toBe('dist');
    expect(result.url).toMatch(/^file:/);
  });
});
