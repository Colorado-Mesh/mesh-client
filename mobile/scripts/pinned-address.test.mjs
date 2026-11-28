// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Source contract (the Swift plugin cannot run here): a native HTTP client that cannot connect to
// the address the host pinned (`x-mesh-pinned-address`) must refuse the request. Stripping the
// header and resolving the host again would undo the host's public-address check (DNS rebinding).
const REPO = path.resolve(import.meta.dirname, '../..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

describe('x-mesh-pinned-address on clients that cannot pin', () => {
  it('the contract tells such a client to refuse', () => {
    const contract = read('mobile/src/native/contracts.ts');
    expect(contract).toContain('must refuse the request');
    expect(contract).not.toContain('cannot pin connect normally');
  });

  it('the iOS HTTP plugin refuses a pinned request and no longer strips the header', () => {
    const swift = read('mobile/ios/App/App/Plugins/MeshNetHttp.swift');
    const start = swift.indexOf('func request(');
    const end = swift.indexOf('func cancelRequest(');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const request = swift.slice(start, end);
    expect(request).toMatch(
      /lowercased\(\) == "x-mesh-pinned-address"[\s\S]*throw MeshNetError\("EPINUNSUPPORTED/,
    );
    expect(request).not.toContain('!= "x-mesh-pinned-address"');
  });

  it('the browser harness bridge refuses a pinned request and no longer strips the header', () => {
    const bridge = read('mobile/scripts/web-bridge.mjs');
    expect(bridge).toContain('EPINUNSUPPORTED');
    expect(bridge).not.toContain("delete headers['x-mesh-pinned-address']");
  });
});
