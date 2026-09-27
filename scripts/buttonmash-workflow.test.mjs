// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/buttonmash.yaml', 'utf8');
const config = JSON.parse(readFileSync('buttonmash.config.json', 'utf8'));

// Buttonmash compiles every ignore pattern case-insensitively.
const isIgnored = (message) =>
  config.detectors.ignorePatterns.some((pattern) =>
    // eslint-disable-next-line security/detect-non-literal-regexp -- Patterns come from the checked-in CI config.
    new RegExp(pattern, 'i').test(message),
  );

// Buttonmash reports a failed request as `METHOD URL <em dash> errorText`.
const DASH = String.fromCharCode(0x2014);

describe('Buttonmash CI', () => {
  it('runs the Vite renderer through the browser-safe Electron API stub', () => {
    expect(workflow).toContain('pnpm exec vite --host 127.0.0.1 --port 4173 --strictPort');
    expect(workflow).toContain('target: http://127.0.0.1:4173');
    expect(workflow).toContain('uses: ./.github/actions/setup-node-pnpm');
  });

  it('pins actions and the CLI while keeping the run bounded and safe', () => {
    expect(workflow).toContain('uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('uses: ./.github/actions/setup-node-pnpm');
    expect(workflow).toContain("node-version: '22.23.2'");
    expect(workflow).toContain('uses: cj-vana/buttonmash@3afca467df4ae6ac71a1c3bcb894083e4e0ffb04');
    expect(workflow).toContain(
      'uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    );
    expect(workflow).toContain("version: '0.3.0'");
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
    // Buttonmash blocks font and media requests by default. Letting them through keeps the run
    // drawing text in the bundled IBM Plex fonts the app serves from its own origin.
    expect(config.guardrails.blockMedia).toBe(false);
    expect(config.detectors.ignorePatterns).toContain(
      'controls\\.start\\(\\) should only be called after a component has mounted',
    );
    expect(config.detectors.ignorePatterns).toContain(
      "Cannot read properties of undefined \\(reading '_leaflet_pos'\\)",
    );
    // Headless CI Chromium may still surface legacy Web Bluetooth noise from stubs.
    expect(config.detectors.ignorePatterns).toContain(
      '\\[WebBluetooth\\] navigator\\.bluetooth is UNDEFINED!',
    );
    expect(config.detectors.ignorePatterns).toContain('Web Bluetooth is not available');
    expect(config.failOn).toBe('high');
  });

  it.each([
    '[useMeshtasticRuntime] Connection failed: BLE peripheral ID required',
    '[useMeshcoreRuntime] connect error BLE peripheral ID required',
  ])('keeps missing-device wiring failures visible: %s', (message) => {
    expect(isIgnored(message)).toBe(false);
  });

  it('ignores offline map tiles only where the Electron-registered scheme is missing', () => {
    // The main process registers `mesh-tiles:`; the plain-browser lane has no main process.
    expect(isIgnored(`GET mesh-tiles://osm/2/1/1.png ${DASH} net::ERR_UNKNOWN_URL_SCHEME`)).toBe(
      true,
    );
    expect(isIgnored(`GET mesh-tiles://osm/2/1/1.png ${DASH} net::ERR_FAILED`)).toBe(false);
    expect(
      isIgnored(`GET https://tile.openstreetmap.org/2/1/1.png ${DASH} net::ERR_NAME_NOT_RESOLVED`),
    ).toBe(false);
  });
});
