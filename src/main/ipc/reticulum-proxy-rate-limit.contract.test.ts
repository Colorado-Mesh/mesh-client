// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const HANDLERS_SOURCE = readFileSync(join(__dirname, 'reticulum-handlers.ts'), 'utf-8');
const SIDECAR_STACK_SOURCE = readFileSync(
  join(__dirname, '../../../reticulum-sidecar/src/stack/mod.rs'),
  'utf-8',
);
const SIDECAR_LIVE_SOURCE = readFileSync(
  join(__dirname, '../../../reticulum-sidecar/src/stack/live.rs'),
  'utf-8',
);

describe('reticulum proxy rate limit + 100k peer ceilings (source contract)', () => {
  it('caps shared proxy IPC at 300/min and treats rate-limit as expected', () => {
    expect(HANDLERS_SOURCE).toMatch(/max:\s*300/);
    expect(HANDLERS_SOURCE).toContain("label: 'reticulum:proxy'");
    expect(HANDLERS_SOURCE).toContain("lower.includes('rate limit exceeded')");
  });

  it('aligns sidecar peer cache and WS added batch with ~100k scale', () => {
    expect(SIDECAR_STACK_SOURCE).toMatch(/const MAX_PEER_CACHE: usize = 100_000;/);
    expect(SIDECAR_LIVE_SOURCE).toMatch(/const MAX_PEERS_UPDATED_ADDED: usize = 4096;/);
    expect(SIDECAR_LIVE_SOURCE).toMatch(/const MAX_DISPLAY_NAME_CACHE: usize = 100_000;/);
    expect(SIDECAR_LIVE_SOURCE).toMatch(
      /const TRANSPORT_QUERY_TIMEOUT: Duration = Duration::from_secs\(20\);/,
    );
  });
});
