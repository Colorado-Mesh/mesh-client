import { describe, expect, it } from 'vitest';

import { TRANSLATION_LANGUAGES, translationPath } from '../../shared/translationLanguages';
import { TRANSLATION_MANIFEST } from './translationManifest';

describe('pinned translation manifest', () => {
  it('has complete English pairs for every supported locale, with unique IDs', () => {
    const ids = TRANSLATION_MANIFEST.map((pack) => pack.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const language of TRANSLATION_LANGUAGES)
      for (const id of [...translationPath(language, 'en'), ...translationPath('en', language)])
        expect(ids).toContain(id);
  });
  it('pins HTTPS binaries with compressed and decoded integrity and required lex/vocabulary', () => {
    for (const pack of TRANSLATION_MANIFEST) {
      if (pack.id !== 'engine') {
        expect(pack.assets.map((asset) => asset.file)).toContain('lex.bin');
        expect(pack.assets.some((asset) => asset.file.endsWith('.spm'))).toBe(true);
      }
      for (const asset of pack.assets) {
        expect(new URL(asset.url).protocol).toBe('https:');
        expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(asset.size).toBeGreaterThan(0);
        if (asset.decodedSize) {
          expect(asset.decodedSize).toBeGreaterThan(0);
          expect(asset.decodedSha256).toMatch(/^[a-f0-9]{64}$/);
        }
      }
    }
  });
});
