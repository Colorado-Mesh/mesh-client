import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BUNDLED_EMOJI_DATA_ETAG,
  BUNDLED_EMOJI_DATA_SOURCE,
  installBundledEmojiData,
  resetBundledEmojiDataForTests,
} from './bundledEmojiData';

const DATA_PATH = join(import.meta.dirname, '..', 'assets', 'emoji', 'emojibase-en.json');

describe('bundled emoji data', () => {
  afterEach(() => {
    resetBundledEmojiDataForTests();
  });

  it('vendors emoji-picker-element data the picker accepts', () => {
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
