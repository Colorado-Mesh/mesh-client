import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { AiFollowUpPromptInput } from '../../shared/aiFollowUpPrompt';
import type { prepareSummarizePrompt } from './summarizePromptPrepare';

export type BuildAiFollowUpPrompt = (input: AiFollowUpPromptInput) => {
  system: string;
  user: string;
  included: number;
  truncated: boolean;
  fits: boolean;
};

export type PrepareSummarizePrompt = typeof prepareSummarizePrompt;

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

/**
 * Sibling `ai-summarize-prompt-prepare.js` — Catch up / follow-up / log prompt build.
 * Keeps prompt construction out of the measured main bundle.
 */
export async function loadSummarizePromptPrepare(): Promise<{
  prepareSummarizePrompt: PrepareSummarizePrompt;
}> {
  if (process.env.VITEST) {
    return import('./summarizePromptPrepare');
  }
  const sibling = path.join(__dirname, 'ai-summarize-prompt-prepare.js');
  return import(pathToFileURL(sibling).href) as Promise<{
    prepareSummarizePrompt: PrepareSummarizePrompt;
  }>;
}
