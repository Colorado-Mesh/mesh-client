import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { buildAiSummaryPrompt } from '../../shared/aiSummaryPrompt';

type BuildAiSummaryPrompt = typeof buildAiSummaryPrompt;

/**
 * Production main ships `ai-summary-prompt.js` next to `index.js` so Catch up
 * summary prompt text stays out of the measured main bundle.
 * Vitest uses the TypeScript source; `process.env.VITEST` is defined away in
 * the production esbuild so that import is dropped from `index.js`.
 */
export async function loadBuildAiSummaryPrompt(): Promise<BuildAiSummaryPrompt> {
  if (process.env.VITEST) {
    const loaded = await import('../../shared/aiSummaryPrompt');
    return loaded.buildAiSummaryPrompt;
  }
  const sibling = path.join(__dirname, 'ai-summary-prompt.js');
  const loaded = (await import(pathToFileURL(sibling).href)) as {
    buildAiSummaryPrompt: BuildAiSummaryPrompt;
  };
  return loaded.buildAiSummaryPrompt;
}
