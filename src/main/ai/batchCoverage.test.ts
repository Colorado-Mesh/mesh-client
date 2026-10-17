import { describe, expect, it } from 'vitest';

import { aiSummaryPromptBudget } from '../../shared/ai-types';
import { packAiSummaryChunks } from '../../shared/aiSummaryChunking';
import { buildSummaryPrompt } from './promptBuilder';

const context = {
  conversationLabel: 'Local chat',
  protocol: 'meshcore',
  surface: 'channel',
  locale: 'en',
  mode: 'map' as const,
};
describe('batch coverage at the main-process prompt boundary', () => {
  it.each(['reduce', 'final'] as const)('does not invent chat dates for %s digests', (mode) => {
    const prompt = buildSummaryPrompt({
      ...context,
      ...aiSummaryPromptBudget('os'),
      mode,
      digests: true,
      messages: [{ at: 1, sender: 'Part 1', body: 'Alice will deliver batteries at 20:00.' }],
    });
    expect(prompt.user).toContain('BEGIN_UNTRUSTED_DIGESTS');
    expect(prompt.user).toContain('END_UNTRUSTED_DIGESTS');
    expect(prompt.user).toContain('20:00');
    expect(prompt.user).not.toMatch(/1969-|1970-/);
    expect(prompt.included).toBe(1);
  });
  it.each(['os', 'bundled', 'local', 'remote'] as const)(
    'keeps every packed message within the actual %s prompt budget',
    (engine) => {
      const messages = Array.from({ length: 169 }, (_, at) => ({
        at,
        sender: 'Alice',
        body: `Message ${at}: radio batteries and repeater plans.`,
      }));
      const chunks = packAiSummaryChunks(messages, engine, context);
      expect(chunks.flat()).toEqual(messages);
      for (const chunk of chunks) {
        const prompt = buildSummaryPrompt({
          ...context,
          ...aiSummaryPromptBudget(engine),
          messages: chunk,
        });
        expect(prompt.included).toBe(chunk.length);
        expect(prompt.truncated).toBe(false);
      }
    },
  );
  it('preserves an oversized message instead of skipping it', () => {
    const message = { at: 1, sender: 'Alice', body: '漢😀\\\n'.repeat(2000) };
    const chunks = packAiSummaryChunks([message], 'os');
    expect(
      chunks
        .flat()
        .map((part) => part.body)
        .join(''),
    ).toBe(message.body);
  });
});
