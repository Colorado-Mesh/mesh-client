// @vitest-environment node
/**
 * MeshCore TCP fixture must swallow socket ECONNRESET on teardown — same as
 * meshtastic-tcp-radio — or Windows Playwright fails with a bare "Error: read ECONNRESET".
 */
import { createConnection } from 'node:net';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { startMeshcoreRadio } from '../e2e/fixtures/meshcore-radio.ts';

const MESHCORE_FIXTURE = 'e2e/fixtures/meshcore-radio.ts';
const MESHTASTIC_FIXTURE = 'e2e/fixtures/meshtastic-tcp-radio.ts';

describe('meshcore-radio E2E fixture socket errors', () => {
  /** @type {Awaited<ReturnType<typeof startMeshcoreRadio>> | undefined} */
  let radio;

  afterEach(async () => {
    if (radio) {
      await radio.close();
      radio = undefined;
    }
  });

  it('keeps the same teardown ECONNRESET swallow as the Meshtastic TCP fixture', () => {
    const meshcore = readFileSync(MESHCORE_FIXTURE, 'utf8');
    const meshtastic = readFileSync(MESHTASTIC_FIXTURE, 'utf8');
    expect(meshtastic).toMatch(/socket\.on\('error'/);
    expect(meshtastic).toMatch(/ECONNRESET/);
    expect(meshcore).toMatch(/socket\.on\('error'/);
    expect(meshcore).toMatch(/ECONNRESET/);
  });

  it('does not surface uncaught ECONNRESET when a client resets the TCP session', async () => {
    radio = await startMeshcoreRadio();
    /** @type {Error[]} */
    const uncaught = [];
    const onUncaught = (err) => {
      uncaught.push(err instanceof Error ? err : new Error(String(err)));
    };
    process.on('uncaughtException', onUncaught);
    try {
      await new Promise((resolve) => {
        const client = createConnection({ host: '127.0.0.1', port: radio.port }, () => {
          client.destroy();
          resolve(undefined);
        });
        client.on('error', () => {
          // Client-side reset / race is expected.
        });
      });
      // Fixture close also destroys accepted sockets (Windows CI failure mode).
      await radio.close();
      radio = undefined;
      await new Promise((r) => setTimeout(r, 50));
      expect(uncaught.map((e) => e.message).join('\n')).not.toMatch(/ECONNRESET/);
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });
});
