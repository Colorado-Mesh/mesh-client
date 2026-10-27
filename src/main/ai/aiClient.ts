import { lookup } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';

import { Agent } from 'undici';

import type { AiWireFormat } from '../../shared/ai-types';
import { AI_MAX_RESPONSE_BYTES, AI_REQUEST_TIMEOUT_MS } from '../../shared/ai-types';
import { type AdapterInput, buildRequest, modelsUrl, parseDelta, parseModels } from './adapters';
import { AiFailure } from './errors';
import { literalAddressIsGlobal, validateAiEndpointUrl } from './urlPolicy';

async function defaultResolveHost(hostname: string): Promise<string> {
  const { address } = await lookup(hostname, { order: 'verbatim' });
  return address;
}

/** Socket lookup that always returns the address already checked by the URL policy. */
function pinnedLookup(address: string): LookupFunction {
  const family = address.includes(':') ? 6 : 4;
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

function connectPort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'http:' ? 80 : 443;
}

export class AiClient {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly resolveHost: (hostname: string) => Promise<string> = defaultResolveHost,
  ) {}
  private async response(
    url: string,
    init: RequestInit,
    allowRemote: boolean,
  ): Promise<{ response: Response; close: () => Promise<void> }> {
    // Validate the final URL too; adapters may append a query but never change the host.
    const endpoint = new URL(url);
    endpoint.search = '';
    const classified = validateAiEndpointUrl(endpoint.href, allowRemote);
    if (!classified.ok) throw new AiFailure('remoteNotAcknowledged');
    const host = endpoint.hostname.replace(/^\[|\]$/g, '');
    const literalGlobal = literalAddressIsGlobal(host);
    let address = host;
    if (literalGlobal == null) {
      try {
        address = await this.resolveHost(host);
      } catch {
        // catch-no-log-ok DNS failure is reported as a generic endpoint error
        throw new AiFailure('error');
      }
    }
    const addressGlobal = literalAddressIsGlobal(address);
    // Remote opt-in must not reach a non-global address, and a local name must not
    // be rebound to a global one. The connect below is pinned to this lookup.
    if (addressGlobal == null || (classified.cls === 'remote') !== addressGlobal)
      throw new AiFailure('error');
    const agent = new Agent({
      connect: {
        lookup: pinnedLookup(address),
        port: connectPort(endpoint),
        servername: literalGlobal == null ? host : undefined,
      },
    });
    const close = (): Promise<void> =>
      agent.close().then(
        () => undefined,
        () => {
          // catch-no-log-ok agent may already be closed after abort
        },
      );
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        redirect: 'error',
        dispatcher: agent,
      } as RequestInit);
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {
          // catch-no-log-ok cleanup errors must not expose private provider details
        });
        await close();
        throw new AiFailure('httpError');
      }
      return { response, close };
    } catch (err) {
      await close();
      throw err;
    }
  }
  async *stream(
    format: AiWireFormat,
    input: AdapterInput,
    allowRemote: boolean,
    signal: AbortSignal,
  ): AsyncGenerator<string> {
    const request = buildRequest(format, input);
    const opened = await this.response(request.url, { ...request.init, signal }, allowRemote);
    const response = opened.response;
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
      await opened.close();
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
    const opened = await this.response(
      modelsUrl(format, input.baseUrl),
      { headers, signal },
      allowRemote,
    );
    const reader = opened.response.body!.getReader();
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
      await opened.close();
    }
    try {
      return parseModels(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
    } catch {
      // catch-no-log-ok invalid model list is safe to report
      throw new AiFailure('invalidResponse');
    }
  }
}
