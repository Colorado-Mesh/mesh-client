import { describe, expect, it } from 'vitest';

import {
  AI_ENDPOINT_MAX_PROMPT_BYTES,
  AI_MAX_MESSAGES,
  AI_ON_DEVICE_MAX_PROMPT_BYTES,
  AI_TYPICAL_SUMMARY_LINE_BYTES,
  aiSummaryPromptBudget,
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
});
