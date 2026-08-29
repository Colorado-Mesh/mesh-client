// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/buttonmash.yaml', 'utf8');
const config = JSON.parse(readFileSync('buttonmash.config.json', 'utf8'));

describe('Buttonmash CI', () => {
  it('runs the Vite renderer through the browser-safe Electron API stub', () => {
    expect(workflow).toContain('pnpm exec vite --host 127.0.0.1 --port 4173 --strictPort');
    expect(workflow).toContain('target: http://127.0.0.1:4173');
    expect(workflow).toContain('pnpm install --frozen-lockfile');
  });

  it('pins actions and the CLI while keeping the run bounded and safe', () => {
    expect(workflow).toContain('uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38');
    expect(workflow).toContain("node-version: '22.23.2'");
    expect(workflow).toContain('uses: cj-vana/buttonmash@3dfe5aa15e824accfd5f72c176ac64b2f63450db');
    expect(workflow).toContain(
      'uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    );
    expect(workflow).toContain("version: '0.2.0'");
    expect(config.seed).toBe('ci');
    expect(config.budget).toMatchObject({
      maxActions: 350,
      maxDurationMs: 300_000,
      maxDepth: 8,
      maxPages: 2,
      saturationLimit: 50,
      actionTimeoutMs: 10_000,
      interactionTimeoutMs: 1_500,
      readyTimeoutMs: 5_000,
    });
    expect(config.explore).toMatchObject({
      crawl: false,
      weights: { dblclick: 0, back: 0, forward: 0 },
      forms: { enabled: false },
    });
    expect(config.guardrails.billing.mode).toBe('refuse');
    expect(config.detectors.ignorePatterns).toContain(
      '\\[useMeshtasticRuntime\\] Connection failed: BLE peripheral ID required on Mac/Windows',
    );
    expect(config.detectors.ignorePatterns).toContain(
      'controls\\.start\\(\\) should only be called after a component has mounted',
    );
    expect(config.detectors.ignorePatterns).toContain(
      "Cannot read properties of undefined \\(reading '_leaflet_pos'\\)",
    );
    expect(config.failOn).toBe('high');
  });
});
