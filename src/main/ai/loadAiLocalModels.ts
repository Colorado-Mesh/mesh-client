import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { AiLocalModel } from './local/modelManifest';

interface CatalogModule {
  AI_LOCAL_MODELS: AiLocalModel[];
}

let cached: AiLocalModel[] | undefined;

/** Sibling `ai-local-models.js` in prod; TS source under Vitest (stripped from index.js). */
export async function loadAiLocalModels(): Promise<AiLocalModel[]> {
  if (cached) return cached;
  if (process.env.VITEST) {
    const loaded = (await import('./local/modelCatalogData')) as CatalogModule;
    cached = loaded.AI_LOCAL_MODELS;
    return cached;
  }
  const sibling = path.join(__dirname, 'ai-local-models.js');
  const loaded = (await import(pathToFileURL(sibling).href)) as CatalogModule;
  cached = loaded.AI_LOCAL_MODELS;
  return cached;
}

/** @internal */
export function resetAiLocalModelsCacheForTests(): void {
  cached = undefined;
}
