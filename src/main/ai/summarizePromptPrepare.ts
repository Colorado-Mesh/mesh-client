import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { AiSummaryPassMode, AiSummaryRequest } from '../../shared/ai-types';
import { resolveAiSummaryFinalStyle } from '../../shared/ai-types';
import type { buildAiFollowUpPrompt } from '../../shared/aiFollowUpPrompt';
import type { buildAiSummaryPrompt } from '../../shared/aiSummaryPrompt';
import { prepareLogAnalysisPrompt } from './logAnalysisPrepare';

export interface SummarizePromptBudget {
  maxChars: number;
  maxPromptBytes: number;
}

export type SummarizePromptResult =
  | {
      ok: true;
      prompt: {
        system: string;
        user: string;
        included: number;
        truncated: boolean;
        fits: boolean;
      };
      finalStyle: 'compact' | 'structured';
    }
  | { ok: false; reason: 'docsUnavailable' | 'tooLarge' | 'noFindings' };

type BuildAiSummaryPrompt = typeof buildAiSummaryPrompt;
type BuildAiFollowUpPrompt = typeof buildAiFollowUpPrompt;

async function loadBuildAiSummaryPrompt(): Promise<BuildAiSummaryPrompt> {
  if (process.env.VITEST) {
    return (await import('../../shared/aiSummaryPrompt')).buildAiSummaryPrompt;
  }
  const sibling = path.join(__dirname, 'ai-summary-prompt.js');
  const loaded = (await import(pathToFileURL(sibling).href)) as {
    buildAiSummaryPrompt: BuildAiSummaryPrompt;
  };
  return loaded.buildAiSummaryPrompt;
}

async function loadBuildAiFollowUpPrompt(): Promise<BuildAiFollowUpPrompt> {
  if (process.env.VITEST) {
    return (await import('../../shared/aiFollowUpPrompt')).buildAiFollowUpPrompt;
  }
  const sibling = path.join(__dirname, 'ai-follow-up-prompt.js');
  const loaded = (await import(pathToFileURL(sibling).href)) as {
    buildAiFollowUpPrompt: BuildAiFollowUpPrompt;
  };
  return loaded.buildAiFollowUpPrompt;
}

/**
 * Build the Catch up / follow-up / log-analysis prompt for `ai:summarize`.
 * Shipped as sibling `ai-summarize-prompt-prepare.js` so the measured main bundle stays lean.
 */
export async function prepareSummarizePrompt(
  request: AiSummaryRequest,
  budget: SummarizePromptBudget,
  isOnline: () => boolean,
): Promise<SummarizePromptResult> {
  const mode: AiSummaryPassMode = request.mode ?? 'final';
  const followUp = request.followUp;
  if (request.surface === 'log') {
    const prepared = await prepareLogAnalysisPrompt(request, budget, isOnline);
    if (!prepared.ok) return prepared;
    if (!prepared.prompt.fits || !prepared.prompt.included)
      return { ok: false, reason: 'tooLarge' };
    return { ok: true, prompt: prepared.prompt, finalStyle: 'compact' };
  }

  let finalStyle =
    mode === 'final'
      ? resolveAiSummaryFinalStyle(request.messages.length, Boolean(request.jobId))
      : 'compact';
  const buildSummaryPrompt = await loadBuildAiSummaryPrompt();
  const buildCatchUpPrompt = (style: typeof finalStyle) => ({
    ...buildSummaryPrompt({
      ...request,
      digests: mode === 'reduce' || (mode === 'final' && Boolean(request.jobId)),
      mode: request.mode ?? 'final',
      finalStyle: style,
      maxChars: budget.maxChars,
      maxPromptBytes: budget.maxPromptBytes,
    }),
    fits: true as const,
  });
  let prompt = followUp
    ? (await loadBuildAiFollowUpPrompt())({
        conversationLabel: request.conversationLabel,
        protocol: request.protocol,
        surface: request.surface,
        locale: request.locale,
        summary: followUp.summary,
        question: followUp.question,
        turns: followUp.turns,
        messages: request.messages,
        contextKind: followUp.contextKind,
        maxChars: budget.maxChars,
        maxPromptBytes: budget.maxPromptBytes,
      })
    : buildCatchUpPrompt(finalStyle);
  if (
    !followUp &&
    mode === 'final' &&
    finalStyle === 'structured' &&
    (prompt.truncated || prompt.included !== request.messages.length || !prompt.included)
  ) {
    finalStyle = 'compact';
    prompt = buildCatchUpPrompt('compact');
  }
  if (!prompt.fits || (!followUp && !prompt.included)) return { ok: false, reason: 'tooLarge' };
  return { ok: true, prompt, finalStyle };
}
