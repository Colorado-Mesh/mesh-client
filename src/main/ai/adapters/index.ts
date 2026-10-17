import type { AiWireFormat } from '../../../shared/ai-types';
import { AiFailure } from '../errors';

export interface AdapterInput {
  baseUrl: string;
  model: string;
  apiKey?: string;
  system: string;
  user: string;
  maxTokens: number;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AiFailure('invalidResponse');
  return value as Record<string, unknown>;
}
function first(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || !value.length) throw new AiFailure('invalidResponse');
  return object(value[0]);
}
export function buildRequest(format: AiWireFormat, input: AdapterInput) {
  const base = input.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const messages = [
    { role: 'system', content: input.system },
    { role: 'user', content: input.user },
  ];
  let url: string;
  let body: object;
  if (format === 'openai') {
    url = `${new URL(base).pathname === '/' ? `${base}/v1` : base}/chat/completions`;
    if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;
    const reasoning = /^(?:o[134](?:-|$)|gpt-[5-9](?:[.-]|$))/.test(input.model);
    // Official OpenAI uses the completion budget; compatible local servers retain max_tokens.
    const modern = new URL(base).hostname === 'api.openai.com' || reasoning;
    body = {
      model: input.model,
      messages,
      [modern ? 'max_completion_tokens' : 'max_tokens']: input.maxTokens + (reasoning ? 2048 : 0),
      stream: true,
    };
  } else if (format === 'anthropic') {
    url = `${base.replace(/\/v1$/, '')}/v1/messages`;
    if (input.apiKey) headers['x-api-key'] = input.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model: input.model,
      system: input.system,
      messages: messages.slice(1),
      max_tokens: input.maxTokens,
      stream: true,
    };
  } else if (format === 'gemini') {
    url = `${base.replace(/\/v1beta$/, '')}/v1beta/models/${encodeURIComponent(input.model.replace(/^models\//, ''))}:streamGenerateContent?alt=sse`;
    if (input.apiKey) headers['x-goog-api-key'] = input.apiKey;
    body = {
      system_instruction: { parts: [{ text: input.system }] },
      contents: [{ parts: [{ text: input.user }] }],
      generationConfig: geminiGenerationConfig(input),
    };
  } else {
    url = `${base.replace(/\/api$/, '')}/api/chat`;
    if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;
    body = {
      model: input.model,
      messages,
      stream: true,
      options: { num_predict: input.maxTokens, temperature: 0.2 },
    };
  }
  return {
    url,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'error',
    } satisfies RequestInit,
  };
}
function geminiGenerationConfig(input: AdapterInput) {
  const model = input.model.replace(/^models\//, '');
  if (/^gemini-2\.5-flash(?:-|$)/.test(model))
    return { maxOutputTokens: input.maxTokens, thinkingConfig: { thinkingBudget: 0 } };
  if (/^gemini-2\.5-pro(?:-|$)/.test(model))
    return { maxOutputTokens: input.maxTokens + 1024, thinkingConfig: { thinkingBudget: 1024 } };
  if (/^gemini-[34](?:[.-]|$)/.test(model))
    return { maxOutputTokens: input.maxTokens + 4096, thinkingConfig: { thinkingLevel: 'low' } };
  return { maxOutputTokens: input.maxTokens };
}
export function parseDelta(format: AiWireFormat, line: string): { delta: string; done: boolean } {
  if (line === '[DONE]') return { delta: '', done: true };
  let value: Record<string, unknown>;
  try {
    value = object(JSON.parse(line) as unknown);
  } catch {
    // catch-no-log-ok never echo provider responses
    throw new AiFailure('invalidResponse');
  }
  if (value.error || value.type === 'error') throw new AiFailure('httpError');
  let delta: unknown = '';
  let done = false;
  if (format === 'openai') {
    const choice = first(value.choices);
    delta = object(choice.delta).content ?? '';
    done = choice.finish_reason != null;
  } else if (format === 'anthropic') {
    if (value.type === 'content_block_delta') delta = object(value.delta).text ?? '';
    done = value.type === 'message_stop';
  } else if (format === 'gemini') {
    if (value.candidates) {
      const c = first(value.candidates);
      if (c.content) {
        const parts = object(c.content).parts;
        if (!Array.isArray(parts)) throw new AiFailure('invalidResponse');
        delta = parts
          .map((p: unknown) => {
            const part = object(p);
            if (part.thought === true) return '';
            const text = part.text;
            if (text === undefined) return '';
            if (typeof text !== 'string') throw new AiFailure('invalidResponse');
            return text;
          })
          .join('');
      }
      done = typeof c.finishReason === 'string';
    }
  } else {
    delta = value.message ? (object(value.message).content ?? '') : '';
    done = value.done === true;
  }
  if (typeof delta !== 'string') throw new AiFailure('invalidResponse');
  return { delta, done };
}
export function modelsUrl(format: AiWireFormat, base: string) {
  if (format === 'ollama') return `${base.replace(/\/api$/, '')}/api/tags`;
  if (format === 'gemini') return `${base.replace(/\/v1beta$/, '')}/v1beta/models`;
  return `${new URL(base).pathname === '/' ? `${base}/v1` : base}/models`;
}
export function parseModels(value: unknown): string[] {
  const root = object(value);
  const list = root.data ?? root.models;
  if (!Array.isArray(list)) throw new AiFailure('invalidResponse');
  return list.slice(0, 500).flatMap((item: unknown) => {
    const row = object(item);
    const id = row.id ?? row.name;
    return typeof id === 'string' && id.length <= 256 ? [id.replace(/^models\//, '')] : [];
  });
}
