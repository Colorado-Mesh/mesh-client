import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BUNDLED_EMOJI_DATA_ETAG,
  BUNDLED_EMOJI_DATA_SOURCE,
  installBundledEmojiData,
  resetBundledEmojiDataForTests,
} from './bundledEmojiData';

const require = createRequire(import.meta.url);
const DATA_PATH = require.resolve('emoji-picker-element-data/en/emojibase/data.json');
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(require.resolve('emoji-picker-element-data/package.json'), 'utf8')) as {
    version: string;
  }
).version;

describe('bundled emoji data', () => {
  afterEach(() => {
    resetBundledEmojiDataForTests();
  });

  it('takes the cache tag from the installed package version', () => {
    expect(BUNDLED_EMOJI_DATA_ETAG).toBe(`W/"emoji-picker-element-data@${PACKAGE_VERSION}-en"`);
  });

  it('bundles emoji-picker-element data the picker accepts', () => {
    const data = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as {
      emoji: string;
      annotation: string;
      group: number;
    }[];
    expect(data.length).toBeGreaterThan(1500);
    expect(data[0]).toMatchObject({ emoji: '😀', annotation: 'grinning face', group: 0 });
  });

  it('answers the sentinel URL locally and passes everything else through', async () => {
    const original = vi.fn().mockResolvedValue(new Response('network'));
    const target = { fetch: original as typeof fetch };
    installBundledEmojiData(target);

    const head = await target.fetch(BUNDLED_EMOJI_DATA_SOURCE, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('etag')).toBe(BUNDLED_EMOJI_DATA_ETAG);
    expect(await head.text()).toBe('');

    const get = await target.fetch(new Request(BUNDLED_EMOJI_DATA_SOURCE));
    const body = (await get.json()) as unknown[];
    expect(body.length).toBeGreaterThan(1500);
    expect(original).not.toHaveBeenCalled();

    await target.fetch('https://example.org/other');
    expect(original).toHaveBeenCalledWith('https://example.org/other', undefined);
  });

  it('installs once', () => {
    const original = vi.fn();
    const target = { fetch: original as unknown as typeof fetch };
    installBundledEmojiData(target);
    const wrapped = target.fetch;
    installBundledEmojiData(target);
    expect(target.fetch).toBe(wrapped);
  });
});
