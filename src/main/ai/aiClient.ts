import type { AiWireFormat } from '../../shared/ai-types';
import { AI_MAX_RESPONSE_BYTES, AI_REQUEST_TIMEOUT_MS } from '../../shared/ai-types';
import { type AdapterInput, buildRequest, modelsUrl, parseDelta, parseModels } from './adapters';
import { AiFailure } from './errors';
import { validateAiEndpointUrl } from './urlPolicy';

export class AiClient {
  constructor(private readonly fetchImpl: typeof fetch) {}
  private async response(url: string, init: RequestInit, allowRemote: boolean): Promise<Response> {
    // Validate the final URL too; adapters may append a query but never change the host.
    const endpoint = new URL(url);
    endpoint.search = '';
    if (!validateAiEndpointUrl(endpoint.href, allowRemote).ok)
      throw new AiFailure('remoteNotAcknowledged');
    const response = await this.fetchImpl(url, { ...init, redirect: 'error' });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {
        // catch-no-log-ok cleanup errors must not expose private provider details
      });
      throw new AiFailure('httpError');
    }
    return response;
  }
  async *stream(
    format: AiWireFormat,
    input: AdapterInput,
    allowRemote: boolean,
    signal: AbortSignal,
  ): AsyncGenerator<string> {
    const request = buildRequest(format, input);
    const response = await this.response(request.url, { ...request.init, signal }, allowRemote);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let buffer = '';
    let event: string[] = [];
    let terminal = false;
    let outputChars = 0;
    const maxOutputChars = input.maxTokens * 4;
    const parse = (line: string) => {
      if (format === 'ollama') return line.trim() ? parseDelta(format, line) : null;
      if (line.startsWith('data:')) {
        event.push(line.slice(5).trimStart());
        return null;
      }
      if (line === '' && event.length) {
        const data = event.join('\n');
        event = [];
        return parseDelta(format, data);
      }
      return null;
    };
    try {
      while (!terminal) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) {
          buffer += decoder.decode();
          if (buffer) buffer += '\n';
          buffer += '\n';
        } else {
          bytes += chunk.value.byteLength;
          if (bytes > AI_MAX_RESPONSE_BYTES) throw new AiFailure('tooLarge');
          buffer += decoder.decode(chunk.value, { stream: true });
        }
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, '');
          buffer = buffer.slice(index + 1);
          const parsed = parse(line);
          if (parsed?.delta) {
            // Reasoning budgets include hidden tokens; independently cap visible summary text.
            const delta = parsed.delta
              .slice(0, maxOutputChars - outputChars)
              .replace(/[\uD800-\uDBFF]$/, '');
            outputChars += delta.length;
            if (delta) yield delta;
            if (outputChars >= maxOutputChars || delta.length < parsed.delta.length)
              terminal = true;
          }
          if (terminal || parsed?.done) {
            terminal = true;
            break;
          }
        }
        if (chunk.done) {
          if (!terminal) throw new AiFailure('invalidResponse');
          break;
        }
      }
    } finally {
      await reader.cancel();
    }
  }
  async list(
    format: AiWireFormat,
    input: AdapterInput,
    allowRemote: boolean,
    signal = AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
  ): Promise<string[]> {
    const headers: Record<string, string> = {};
    if (input.apiKey) {
      if (format === 'anthropic') {
        headers['x-api-key'] = input.apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else if (format === 'gemini') headers['x-goog-api-key'] = input.apiKey;
      else headers.Authorization = `Bearer ${input.apiKey}`;
    }
    const response = await this.response(
      modelsUrl(format, input.baseUrl),
      { headers, signal },
      allowRemote,
    );
    const reader = response.body!.getReader();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > AI_MAX_RESPONSE_BYTES) throw new AiFailure('tooLarge');
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    try {
      return parseModels(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
    } catch {
      // catch-no-log-ok invalid model list is safe to report
      throw new AiFailure('invalidResponse');
    }
  }
}
