import { describe, expect, it, vi } from 'vitest';

import {
  hasAppliedRendererStorageIntent,
  parseRendererStorageDeletionState,
  parseRendererStorageIntent,
  RENDERER_STORAGE_DELETION_STATE_MAX_LENGTH,
  rendererStorageIntentOrigin,
} from './rendererStorageIntent';

describe('renderer storage intent compatibility and validation', () => {
  it('allows Node helpers to import the renderer adapter without DOM storage', async () => {
    vi.stubGlobal('localStorage', undefined);
    try {
      const module = await import('../renderer/lib/rendererStorage');
      expect(module.createRendererStorage).toBeTypeOf('function');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['file:///Applications/Mesh%20Client.app/index.html', 'file:'],
    ['mesh-client://renderer/index.html?test=1', 'mesh-client://renderer'],
    ['http://localhost:5173/index.html', 'http://localhost:5173'],
    ['https://localhost:5174/path', 'https://localhost:5174'],
  ])('identifies the renderer origin of %s', (href, origin) => {
    expect(rendererStorageIntentOrigin(href)).toBe(origin);
    const pending = { id: 'operation-id', origin, deleted: true };
    expect(parseRendererStorageIntent(JSON.stringify(pending))).toEqual(pending);
  });

  it.each(['mesh-client://foreign/index.html', 'about:blank', 'not a URL'])(
    'rejects unsupported renderer document %s',
    (href) => {
      expect(() => rendererStorageIntentOrigin(href)).toThrow();
    },
  );

  it.each(['0', '1'])('gives legacy journal %s a stable source identity', (raw) => {
    expect(parseRendererStorageIntent(raw)).toEqual({
      id: `legacy:${raw}`,
      origin: 'file:',
      deleted: raw === '1',
    });
    expect(parseRendererStorageDeletionState(raw)).toEqual({
      deleted: raw === '1',
      applied: {},
      imported: {},
    });
  });

  it('reads receipts without losing the immutable imported identity', () => {
    const state = {
      deleted: false,
      applied: { 'file:': 'newer-file-edit', 'mesh-client://renderer': 'custom-edit' },
      imported: { 'file:': 'original-copied-intent' },
    };
    expect(parseRendererStorageDeletionState(JSON.stringify(state))).toEqual(state);
    expect(
      hasAppliedRendererStorageIntent(state, {
        id: 'original-copied-intent',
        origin: 'file:',
        deleted: true,
      }),
    ).toBe(true);
    expect(
      hasAppliedRendererStorageIntent(state, {
        id: 'new-file-edit',
        origin: 'file:',
        deleted: true,
      }),
    ).toBe(false);
  });

  it('upgrades canonical state from before imported receipts were introduced', () => {
    expect(parseRendererStorageDeletionState(undefined)).toEqual({
      deleted: false,
      applied: {},
      imported: {},
    });
    expect(
      parseRendererStorageDeletionState(
        JSON.stringify({ deleted: true, applied: { 'file:': 'old-operation' } }),
      ),
    ).toEqual({ deleted: true, applied: { 'file:': 'old-operation' }, imported: {} });
  });

  it.each([
    '{invalid',
    'null',
    '[]',
    '{}',
    '{"id":"","origin":"file:","deleted":true}',
    '{"id":"a","origin":"mesh-client://foreign","deleted":true}',
    '{"id":"a","origin":"http://localhost:5173/path","deleted":true}',
    '{"id":"a","origin":"file:","deleted":"1"}',
  ])('rejects malformed pending intent %s', (raw) => {
    expect(() => parseRendererStorageIntent(raw)).toThrow();
  });

  it.each([
    '{invalid',
    'null',
    '[]',
    '{}',
    '{"deleted":true,"applied":[]}',
    '{"deleted":true,"applied":{"file:":false}}',
    '{"deleted":true,"applied":{"mesh-client://foreign":"id"}}',
    '{"deleted":true,"applied":{},"imported":[]}',
    '{"deleted":true,"applied":{},"imported":{"file:":null}}',
  ])('rejects malformed canonical receipt state %s', (raw) => {
    expect(() => parseRendererStorageDeletionState(raw)).toThrow();
  });

  it('bounds both persisted formats before parsing or allocating a receipt dictionary', () => {
    const raw = ' '.repeat(RENDERER_STORAGE_DELETION_STATE_MAX_LENGTH + 1);
    expect(() => parseRendererStorageIntent(raw)).toThrow(RangeError);
    expect(() => parseRendererStorageDeletionState(raw)).toThrow(RangeError);
    expect(() =>
      parseRendererStorageIntent(
        JSON.stringify({ id: 'x'.repeat(129), origin: 'file:', deleted: true }),
      ),
    ).toThrow(TypeError);
  });
});
