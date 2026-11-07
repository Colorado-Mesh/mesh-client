import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { AiFollowUpPromptInput } from '../../shared/aiFollowUpPrompt';

type BuildAiFollowUpPrompt = (input: AiFollowUpPromptInput) => {
  system: string;
  user: string;
  included: number;
  truncated: boolean;
  fits: boolean;
};

/**
 * Production main ships `ai-follow-up-prompt.js` next to `index.js` so the
 * follow-up prompt module stays out of the measured main bundle.
 * Vitest uses the TypeScript source; `process.env.VITEST` is defined away in
 * the production esbuild so that import is dropped from `index.js`.
 */
export async function loadBuildAiFollowUpPrompt(): Promise<BuildAiFollowUpPrompt> {
  if (process.env.VITEST) {
    const loaded = await import('../../shared/aiFollowUpPrompt');
    return loaded.buildAiFollowUpPrompt;
  }
  const sibling = path.join(__dirname, 'ai-follow-up-prompt.js');
  const loaded = (await import(pathToFileURL(sibling).href)) as {
    buildAiFollowUpPrompt: BuildAiFollowUpPrompt;
  };
  return loaded.buildAiFollowUpPrompt;
}
