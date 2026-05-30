import { Utils } from '@meshtastic/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertMeshtasticSerialWebStreamsAvailable,
  assertTransportReadyForMeshDevice,
  formatJsonForRendererLog,
  getMeshtasticStreamsDiagnostics,
} from './connectionWebStreams';

/** Guards Issue #407: @meshtastic/core still exports Utils.toDeviceStream for other transports. */
describe('Meshtastic Utils.toDeviceStream (core stream contract)', () => {
  it('exposes toDeviceStream.readable.pipeTo (same module resolution as MeshDevice)', () => {
    expect(typeof Utils.toDeviceStream).not.toBe('function');
    const td = Utils.toDeviceStream as TransformStream;
    expect(td?.readable != null).toBe(true);
    expect(typeof td.readable.pipeTo).toBe('function');
    expect(typeof td.writable?.getWriter).toBe('function');
  });
});

describe('connectionWebStreams', () => {
  describe('getMeshtasticStreamsDiagnostics', () => {
    it('reports presence of core Web Streams APIs', () => {
      const d = getMeshtasticStreamsDiagnostics();
      expect(typeof d.hasTransformStream).toBe('boolean');
      expect(typeof d.hasReadablePipeTo).toBe('boolean');
      expect(typeof d.hasWritableStream).toBe('boolean');
      expect(typeof d.userAgentSnippet).toBe('string');
    });
  });

  describe('formatJsonForRendererLog', () => {
    it('produces a single JSON string (disk-log safe)', () => {
      const s = formatJsonForRendererLog({ a: 1, b: 'x' });
      expect(s).toContain('"a"');
      expect(s).toContain('"b"');
      expect(s).not.toContain('[object Object]');
    });
  });

  describe('assertMeshtasticSerialWebStreamsAvailable', () => {
    let savedTransformStream: typeof TransformStream;

    beforeEach(() => {
      savedTransformStream = globalThis.TransformStream;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (savedTransformStream !== undefined) {
        globalThis.TransformStream = savedTransformStream;
      } else {
        delete (globalThis as Record<string, unknown>).TransformStream;
      }
    });

    it('throws a clear error when TransformStream is missing', () => {
      delete (globalThis as Record<string, unknown>).TransformStream;

      expect(() => {
        assertMeshtasticSerialWebStreamsAvailable();
      }).toThrow(/Meshtastic serial requires Web Streams/);
    });
  });

  describe('assertTransportReadyForMeshDevice', () => {
    it('throws when fromDevice is missing', () => {
      const toDevice = new WritableStream<Uint8Array>();
      expect(() => {
        assertTransportReadyForMeshDevice({ toDevice }, 'test context');
      }).toThrow(/test context: Meshtastic transport is missing readable\/writable streams/);
    });

    it('throws when toDevice is missing', () => {
      const fromDevice = new ReadableStream<Uint8Array>();
      expect(() => {
        assertTransportReadyForMeshDevice({ fromDevice }, 'test context');
      }).toThrow(/test context: Meshtastic transport is missing readable\/writable streams/);
    });

    it('does not throw for a minimal valid transport', () => {
      const fromDevice = new ReadableStream<Uint8Array>();
      const toDevice = new WritableStream<Uint8Array>();
      expect(() => {
        assertTransportReadyForMeshDevice({ fromDevice, toDevice }, 'ok');
      }).not.toThrow();
    });
  });
});
