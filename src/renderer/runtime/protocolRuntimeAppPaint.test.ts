import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isMeshProtocol, REGISTERED_MESH_PROTOCOLS } from '@/shared/meshProtocol';

import {
  collectProtocolRuntimeAppPaintIssues,
  createInertProtocolRuntimeBase,
  PROTOCOL_RUNTIME_APP_PAINT_FIELDS,
  runAppPaintAdapters,
} from './protocolRuntimeAppPaint';
import {
  getProtocolRuntimeDisabledStub,
  PROTOCOL_RUNTIME_DISABLED_STUBS,
} from './protocolRuntimeDisabledStubs';

const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));

/** `meshcomRuntimeDisabledStub.ts` → `meshcom`. */
function protocolFromDisabledStubFile(fileName: string): string | null {
  const match = /^([a-z0-9]+)RuntimeDisabledStub\.ts$/.exec(fileName);
  return match?.[1] ?? null;
}

describe('protocolRuntimeAppPaint', () => {
  it('inert base exposes every App paint field and survives adapters', () => {
    const base = createInertProtocolRuntimeBase();
    expect(collectProtocolRuntimeAppPaintIssues(base)).toEqual([]);
    expect(() => {
      runAppPaintAdapters(base);
    }).not.toThrow();
    for (const field of PROTOCOL_RUNTIME_APP_PAINT_FIELDS) {
      expect(base).toHaveProperty(field);
    }
  });

  it('flags the incomplete stub shape that caused launch TypeError', () => {
    // Intentionally omit traceRouteResults / channels — App used to crash here.
    const incomplete = {};
    const issues = collectProtocolRuntimeAppPaintIssues(incomplete);
    expect(issues.some((i) => i.startsWith('traceRouteResults'))).toBe(true);
    expect(issues.some((i) => i.startsWith('channels'))).toBe(true);
    expect(() => {
      runAppPaintAdapters(incomplete);
    }).not.toThrow();
  });

  it.each([...REGISTERED_MESH_PROTOCOLS])(
    '%s disabled/pre-live stub (if any) is App-paint safe',
    (protocol) => {
      const stub = getProtocolRuntimeDisabledStub(protocol);
      if (!stub) {
        // Always-on runtimes (meshtastic / meshcore / reticulum today) have no stub.
        expect(protocol in PROTOCOL_RUNTIME_DISABLED_STUBS).toBe(false);
        return;
      }
      expect(collectProtocolRuntimeAppPaintIssues(stub)).toEqual([]);
      expect(() => {
        runAppPaintAdapters(stub);
      }).not.toThrow();
    },
  );

  it('every *RuntimeDisabledStub.ts is registered for a MeshProtocol', () => {
    const stubFiles = readdirSync(RUNTIME_DIR).filter((name) =>
      name.endsWith('RuntimeDisabledStub.ts'),
    );
    expect(stubFiles.length).toBeGreaterThan(0);

    const registered = new Set<string>(Object.keys(PROTOCOL_RUNTIME_DISABLED_STUBS));
    for (const fileName of stubFiles) {
      const protocol = protocolFromDisabledStubFile(fileName);
      expect(protocol, `${fileName} must be <protocol>RuntimeDisabledStub.ts`).toBeTruthy();
      expect(isMeshProtocol(protocol!)).toBe(true);
      expect(registered.has(protocol!)).toBe(true);
    }
  });

  it('disabled-stub registry only names registered protocols', () => {
    const registered = new Set<string>(REGISTERED_MESH_PROTOCOLS);
    for (const key of Object.keys(PROTOCOL_RUNTIME_DISABLED_STUBS)) {
      expect(registered.has(key)).toBe(true);
    }
  });
});
