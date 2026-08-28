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

  it('pins the action and CLI while keeping the run bounded and safe', () => {
    expect(workflow).toContain('uses: cj-vana/buttonmash@3dfe5aa15e824accfd5f72c176ac64b2f63450db');
    expect(workflow).toContain("version: '0.2.0'");
    expect(config.seed).toBe('ci');
    expect(config.budget).toMatchObject({ maxActions: 800, maxDurationMs: 600_000 });
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
