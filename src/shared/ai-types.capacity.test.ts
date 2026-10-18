import { describe, expect, it } from 'vitest';

import {
  AI_DEFAULT_MAX_COLLECTED_MESSAGES,
  AI_ENDPOINT_MAX_PROMPT_BYTES,
  AI_MAP_OUTPUT_TOKENS,
  AI_MAX_MAX_COLLECTED_MESSAGES,
  AI_MAX_MESSAGES,
  AI_MAX_OUTPUT_TOKENS,
  AI_MIN_MAX_COLLECTED_MESSAGES,
  AI_ON_DEVICE_MAX_PROMPT_BYTES,
  AI_REDUCE_OUTPUT_TOKENS,
  AI_TYPICAL_SUMMARY_LINE_BYTES,
  aiSummaryOutputTokens,
  aiSummaryPromptBudget,
  clampAiMaxCollectedMessages,
  estimateAiSummaryMessageCapacity,
} from './ai-types';

describe('AI summary capacity helpers', () => {
  it('exposes on-device and endpoint prompt budgets', () => {
    expect(aiSummaryPromptBudget('os')).toEqual({
      maxChars: 9000,
      maxPromptBytes: AI_ON_DEVICE_MAX_PROMPT_BYTES,
    });
    expect(aiSummaryPromptBudget('bundled')).toEqual({
      maxChars: 20_000,
      maxPromptBytes: AI_ON_DEVICE_MAX_PROMPT_BYTES,
    });
    expect(aiSummaryPromptBudget('local')).toEqual({
      maxChars: 60_000,
      maxPromptBytes: AI_ENDPOINT_MAX_PROMPT_BYTES,
    });
    expect(aiSummaryPromptBudget('remote')).toEqual(aiSummaryPromptBudget('local'));
  });

  it('estimates typical message capacity from the prompt budget', () => {
    expect(estimateAiSummaryMessageCapacity('os')).toBe(
      Math.floor(AI_ON_DEVICE_MAX_PROMPT_BYTES / AI_TYPICAL_SUMMARY_LINE_BYTES),
    );
    expect(estimateAiSummaryMessageCapacity('bundled')).toBe(
      estimateAiSummaryMessageCapacity('os'),
    );
    expect(estimateAiSummaryMessageCapacity('local')).toBe(AI_MAX_MESSAGES);
    expect(estimateAiSummaryMessageCapacity('remote')).toBe(AI_MAX_MESSAGES);
  });

  it('uses shorter completion budgets for map and reduce passes', () => {
    expect(aiSummaryOutputTokens('map')).toBe(AI_MAP_OUTPUT_TOKENS);
    expect(aiSummaryOutputTokens('reduce')).toBe(AI_REDUCE_OUTPUT_TOKENS);
    expect(aiSummaryOutputTokens('final')).toBe(AI_MAX_OUTPUT_TOKENS);
    expect(AI_MAP_OUTPUT_TOKENS).toBeLessThan(AI_MAX_OUTPUT_TOKENS);
  });

  it('clamps the user collection ceiling', () => {
    expect(clampAiMaxCollectedMessages(undefined)).toBe(AI_DEFAULT_MAX_COLLECTED_MESSAGES);
    expect(clampAiMaxCollectedMessages(AI_MIN_MAX_COLLECTED_MESSAGES)).toBe(
      AI_MIN_MAX_COLLECTED_MESSAGES,
    );
    expect(clampAiMaxCollectedMessages(AI_MAX_MAX_COLLECTED_MESSAGES)).toBe(
      AI_MAX_MAX_COLLECTED_MESSAGES,
    );
    expect(clampAiMaxCollectedMessages(99)).toBe(AI_DEFAULT_MAX_COLLECTED_MESSAGES);
    expect(clampAiMaxCollectedMessages(5001)).toBe(AI_DEFAULT_MAX_COLLECTED_MESSAGES);
  });
});
