import type { AiSummaryMessage, AiSummaryRequest } from '../../shared/ai-types';
import {
  buildAiLogAnalysisPrompt,
  isEmptyLogAnalysisFindings,
} from '../../shared/aiLogAnalysisPrompt';
import { logCaughtDebug } from '../caughtErrorPolicy';
import { fetchLogDocsForAnalysis, LogDocsUnavailableError } from './fetchLogDocs';

export interface LogAnalysisPromptBudget {
  maxChars: number;
  maxPromptBytes: number;
}

export type PreparedLogAnalysisPrompt =
  | { ok: true; prompt: ReturnType<typeof buildAiLogAnalysisPrompt> }
  | { ok: false; reason: 'docsUnavailable' | 'noFindings' };

/**
 * Sibling-entry helper: fetch allowlisted docs, select excerpts, build the log prompt.
 * Kept out of measured main `index.js` via `ai-summarize-prompt-prepare.js`.
 */
export async function prepareLogAnalysisPrompt(
  request: Pick<AiSummaryRequest, 'conversationLabel' | 'protocol' | 'locale' | 'messages'>,
  budget: LogAnalysisPromptBudget,
  isOnline: () => boolean,
): Promise<PreparedLogAnalysisPrompt> {
  if (isEmptyLogAnalysisFindings(request.messages)) {
    return { ok: false, reason: 'noFindings' };
  }
  const docsBudget = Math.max(512, Math.floor(budget.maxPromptBytes * 0.45));
  const findingHints = request.messages.flatMap((message: AiSummaryMessage) => [
    message.sender,
    message.body,
  ]);
  try {
    const docs = await fetchLogDocsForAnalysis(request.protocol, findingHints, docsBudget, {
      isOnline,
    });
    return {
      ok: true,
      prompt: buildAiLogAnalysisPrompt({
        conversationLabel: request.conversationLabel,
        protocol: request.protocol,
        locale: request.locale,
        messages: request.messages,
        maxChars: budget.maxChars,
        maxPromptBytes: budget.maxPromptBytes,
        docsText: docs.docsText,
        docsUrl: docs.docsUrl,
      }),
    };
  } catch (error: unknown) {
    if (!(error instanceof LogDocsUnavailableError)) {
      logCaughtDebug('[main/ai/logAnalysisPrepare] docs fetch failed', error);
    }
    return { ok: false, reason: 'docsUnavailable' };
  }
}
