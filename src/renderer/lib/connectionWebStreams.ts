/**
 * Meshtastic stack (@meshtastic/core MeshDevice + @meshtastic/transport-web-serial) relies on
 * Web Streams (TransformStream, ReadableStream.pipeTo, WritableStream). Fail fast with actionable
 * errors instead of "Cannot read properties of undefined (reading 'pipeTo')".
 */

export interface MeshtasticStreamsDiagnostics {
  hasTransformStream: boolean;
  hasReadablePipeTo: boolean;
  hasWritableStream: boolean;
  /** Chromium/Electron user agent (truncated in logs if very long). */
  userAgentSnippet: string;
}

export function getMeshtasticStreamsDiagnostics(): MeshtasticStreamsDiagnostics {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return {
    hasTransformStream: typeof TransformStream !== 'undefined',
    hasReadablePipeTo:
      typeof ReadableStream !== 'undefined' &&
      typeof ReadableStream.prototype.pipeTo === 'function',
    hasWritableStream: typeof WritableStream !== 'undefined',
    userAgentSnippet: ua.length > 160 ? `${ua.slice(0, 160)}…` : ua,
  };
}

/**
 * Call before `TransportWebSerial.create` / `createFromPort` so serial connect fails with a clear
 * message if Web Streams are missing (some embedders strip them).
 */
export function assertMeshtasticSerialWebStreamsAvailable(): void {
  const d = getMeshtasticStreamsDiagnostics();
  const missing: string[] = [];
  if (!d.hasTransformStream) missing.push('TransformStream');
  if (!d.hasReadablePipeTo) missing.push('ReadableStream.prototype.pipeTo');
  if (!d.hasWritableStream) missing.push('WritableStream');
  if (missing.length === 0) return;

  console.error('[connection] Meshtastic serial: Web Streams unavailable', { ...d, missing });
  throw new Error(
    `Meshtastic serial requires Web Streams (${missing.join(', ')}). Update the app or use another connection type if available.`,
  );
}

function isReadableStreamWithPipeTo(x: unknown): x is ReadableStream {
  return (
    x != null &&
    typeof (x as ReadableStream).pipeTo === 'function' &&
    typeof (x as ReadableStream).getReader === 'function'
  );
}

function isWritableStreamWithWriter(x: unknown): x is WritableStream {
  return x != null && typeof (x as WritableStream).getWriter === 'function';
}

/**
 * Validates transport shape before `new MeshDevice(transport)` so missing streams surface as a clear
 * invariant error instead of failing inside `MeshDevice` on `fromDevice.pipeTo`.
 */
export function assertTransportReadyForMeshDevice(transport: unknown, context: string): void {
  if (transport == null || typeof transport !== 'object') {
    throw new Error(`${context}: transport is missing or invalid`);
  }
  const t = transport as { fromDevice?: unknown; toDevice?: unknown };
  const fromOk = isReadableStreamWithPipeTo(t.fromDevice);
  const toOk = isWritableStreamWithWriter(t.toDevice);
  if (fromOk && toOk) return;

  console.error('[connection] Transport missing streams for MeshDevice', context, {
    ...getMeshtasticStreamsDiagnostics(),
    hasFromDevice: t.fromDevice != null,
    fromHasPipeTo: typeof (t.fromDevice as { pipeTo?: unknown })?.pipeTo === 'function',
    hasToDevice: t.toDevice != null,
    toHasGetWriter: typeof (t.toDevice as { getWriter?: unknown })?.getWriter === 'function',
  });
  throw new Error(
    `${context}: Meshtastic transport is missing readable/writable streams (fromDevice/toDevice). Reconnect USB serial or try another transport; include app version if reporting.`,
  );
}
