import { createRequire } from 'node:module';
import path from 'node:path';

import type { TranslationManifestPack } from './translationManifest';

const requireFromHere = createRequire(__filename);

interface Mod {
  TRANSLATION_ENGINE: TranslationManifestPack;
  TRANSLATION_MODEL_PACKS: TranslationManifestPack[];
  TRANSLATION_MANIFEST: TranslationManifestPack[];
}

let cached: Mod | undefined;

/**
 * Production loads sibling `translation-manifest.js` (out of measured index.js budget).
 * Vitest cannot extensionless-require the `.ts` source (Node 22.15–22.17); tests must call
 * {@link setTranslationManifestModForTests} (or pass `manifest` into TranslationPackManager).
 */
function loadTranslationManifestMod(): Mod {
  if (cached) return cached;
  if (process.env.VITEST) {
    throw new Error(
      'loadTranslationManifest: under Vitest call setTranslationManifestModForTests() or pass deps.manifest',
    );
  }
  cached = requireFromHere(path.join(__dirname, 'translation-manifest.js')) as Mod;
  return cached;
}

/** Test-only: inject the TypeScript manifest module (avoids extensionless require). */
export function setTranslationManifestModForTests(mod: Mod): void {
  cached = mod;
}

/** @internal */
export function resetTranslationManifestCacheForTests(): void {
  cached = undefined;
}

export function getTranslationManifest(): TranslationManifestPack[] {
  return loadTranslationManifestMod().TRANSLATION_MANIFEST;
}

export function getTranslationEngine(): TranslationManifestPack {
  return loadTranslationManifestMod().TRANSLATION_ENGINE;
}

export function getTranslationModelPacks(): TranslationManifestPack[] {
  return loadTranslationManifestMod().TRANSLATION_MODEL_PACKS;
}
