/**
 * Mobile replacement for `src/main/translation/loadTranslationManifest.ts`: the manifest is
 * bundled statically (the host worker has no sibling `translation-manifest.js` to require).
 */
import {
  TRANSLATION_ENGINE,
  TRANSLATION_MANIFEST,
  TRANSLATION_MODEL_PACKS,
  type TranslationManifestPack,
} from '@/main/translation/translationManifest';

export interface Mod {
  TRANSLATION_ENGINE: TranslationManifestPack;
  TRANSLATION_MODEL_PACKS: TranslationManifestPack[];
  TRANSLATION_MANIFEST: TranslationManifestPack[];
}

let cached: Mod = { TRANSLATION_ENGINE, TRANSLATION_MODEL_PACKS, TRANSLATION_MANIFEST };

export function setTranslationManifestModForTests(mod: Mod): void {
  cached = mod;
}

export function resetTranslationManifestCacheForTests(): void {
  cached = { TRANSLATION_ENGINE, TRANSLATION_MODEL_PACKS, TRANSLATION_MANIFEST };
}

export function getTranslationManifest(): TranslationManifestPack[] {
  return cached.TRANSLATION_MANIFEST;
}

export function getTranslationEngine(): TranslationManifestPack {
  return cached.TRANSLATION_ENGINE;
}

export function getTranslationModelPacks(): TranslationManifestPack[] {
  return cached.TRANSLATION_MODEL_PACKS;
}
