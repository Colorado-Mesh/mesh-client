// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildAiLogAnalysisPrompt } from './aiLogAnalysisPrompt';

describe('buildAiLogAnalysisPrompt', () => {
  it('separates trusted docs from untrusted log findings', () => {
    const prompt = buildAiLogAnalysisPrompt(
      {
        conversationLabel: 'meshtastic log analysis',
        protocol: 'meshtastic',
        locale: 'en',
        docsText: '## BLE\nCheck distance.',
        docsUrl: 'https://colorado-mesh.github.io/mesh-client/troubleshooting/',
        maxChars: 20_000,
        maxPromptBytes: 64_000,
        messages: [
          {
            at: 1_700_000_000_000,
            sender: 'ble-connection',
            body: 'BLE Connection Issues (count=2). Check distance. Samples: warn line',
          },
        ],
      },
      'UTC',
    );
    expect(prompt.fits).toBe(true);
    expect(prompt.included).toBe(1);
    expect(prompt.system).toContain('Trusted product troubleshooting');
    expect(prompt.user).toContain('BEGIN_TRUSTED_DOCS');
    expect(prompt.user).toContain('## BLE');
    expect(prompt.user).toContain('END_TRUSTED_DOCS');
    expect(prompt.user).toContain('BEGIN_UNTRUSTED_LOG_FINDINGS');
    expect(prompt.user).toContain('ble-connection');
    expect(prompt.user).toContain('troubleshooting/');
    expect(prompt.user).not.toContain('BEGIN_UNTRUSTED_TRANSCRIPT');
  });

  it('reports fits false when framing alone exceeds the byte budget', () => {
    const prompt = buildAiLogAnalysisPrompt({
      conversationLabel: 'x',
      protocol: 'meshcore',
      locale: 'en',
      docsText: 'docs',
      docsUrl: 'https://example.invalid/',
      maxChars: 100,
      maxPromptBytes: 20,
      messages: [{ at: 1, sender: 'a', body: 'b' }],
    });
    expect(prompt.fits).toBe(false);
    expect(prompt.included).toBe(0);
  });
});
