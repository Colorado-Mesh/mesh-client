// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./fetchLogDocs', () => {
  class LogDocsUnavailableError extends Error {
    constructor(message = 'docsUnavailable') {
      super(message);
      this.name = 'LogDocsUnavailableError';
    }
  }
  return {
    LogDocsUnavailableError,
    fetchLogDocsForAnalysis: vi.fn(),
  };
});

import { fetchLogDocsForAnalysis, LogDocsUnavailableError } from './fetchLogDocs';
import { prepareLogAnalysisPrompt } from './logAnalysisPrepare';

const mockedFetch = vi.mocked(fetchLogDocsForAnalysis);

beforeEach(() => {
  mockedFetch.mockReset();
});

describe('prepareLogAnalysisPrompt', () => {
  it('returns docsUnavailable when fetch fails', async () => {
    mockedFetch.mockRejectedValue(new LogDocsUnavailableError());
    const prepared = await prepareLogAnalysisPrompt(
      {
        conversationLabel: 'meshtastic log analysis',
        protocol: 'meshtastic',
        locale: 'en',
        messages: [
          {
            at: 1,
            sender: 'ble-connection',
            body: 'BLE connection unstable',
          },
        ],
      },
      { maxChars: 4_000, maxPromptBytes: 12_000 },
      () => true,
    );
    expect(prepared).toEqual({ ok: false, reason: 'docsUnavailable' });
  });

  it('builds a prompt when docs are available', async () => {
    mockedFetch.mockResolvedValue({
      docsText: '## BLE connection\n\nReset pairing and retry.\n',
      docsUrl: 'https://docs.example/troubleshooting/',
      truncated: false,
    });
    const prepared = await prepareLogAnalysisPrompt(
      {
        conversationLabel: 'meshtastic log analysis',
        protocol: 'meshtastic',
        locale: 'en',
        messages: [
          {
            at: 1,
            sender: 'ble-connection',
            body: 'BLE connection unstable',
          },
        ],
      },
      { maxChars: 4_000, maxPromptBytes: 12_000 },
      () => true,
    );
    expect(prepared).toEqual(
      expect.objectContaining({
        ok: true,
        prompt: expect.objectContaining({
          included: expect.any(Number),
          user: expect.stringContaining('BLE connection'),
        }),
      }),
    );
    expect(mockedFetch).toHaveBeenCalledWith(
      'meshtastic',
      expect.any(Array),
      expect.any(Number),
      expect.objectContaining({ isOnline: expect.any(Function) }),
    );
  });
});
