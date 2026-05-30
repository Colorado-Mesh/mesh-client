/**
 * Meshtastic stack (@meshtastic/core MeshDevice + @meshtastic/transport-web-serial) relies on
 * Web Streams (TransformStream, ReadableStream.pipeTo, WritableStream). Fail fast with actionable
 * errors instead of "Cannot read properties of undefined (reading 'pipeTo')".
 */

import { sanitizeLogMessage } from '@/main/sanitize-log-message';

const MAX_USER_AGENT_SNIPPET_LENGTH = 160;

/** One string for the renderer→main log forwarder (avoids "[object Object]" in disk logs). */
export function formatJsonForRendererLog(detail: Record<string, unknown>): string {
  try {
    return sanitizeLogMessage(JSON.stringify(detail));
  } catch {
    // catch-no-log-ok stringify fallback for circular / non-serializable log payloads
    return sanitizeLogMessage('{}');
  }
}

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
    userAgentSnippet:
      ua.length > MAX_USER_AGENT_SNIPPET_LENGTH
        ? `${ua.slice(0, MAX_USER_AGENT_SNIPPET_LENGTH)}…`
        : ua,
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

  console.error(
    `[connection] Meshtastic serial: Web Streams unavailable ${formatJsonForRendererLog({
      ...d,
      missing,
    })}`,
  );
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

  console.error(
    `[connection] Transport missing streams for MeshDevice ${sanitizeLogMessage(context)} ${formatJsonForRendererLog(
      {
        ...getMeshtasticStreamsDiagnostics(),
        hasFromDevice: t.fromDevice != null,
        fromHasPipeTo: isReadableStreamWithPipeTo(t.fromDevice),
        hasToDevice: t.toDevice != null,
        toHasGetWriter: isWritableStreamWithWriter(t.toDevice),
      },
    )}`,
  );
  throw new Error(
    `${context}: Meshtastic transport is missing readable/writable streams (fromDevice/toDevice). Reconnect USB serial or try another transport; include app version if reporting.`,
  );
}

export interface MeshtasticSerialStreamDiagnostics {
  portHasReadable: boolean | undefined;
  portHasWritable: boolean | undefined;
  fromDeviceLocked: boolean | undefined;
}

/** Snapshot Web Serial port + transport stream lock state for reconnect debugging. */
export function getMeshtasticSerialStreamDiagnostics(
  transport: unknown,
  port?: SerialPort | null,
): MeshtasticSerialStreamDiagnostics {
  const fromDevice = (transport as { fromDevice?: ReadableStream } | null)?.fromDevice;
  let fromDeviceLocked: boolean | undefined;
  if (fromDevice != null && 'locked' in fromDevice) {
    fromDeviceLocked = fromDevice.locked;
  }
  return {
    portHasReadable: port != null ? port.readable != null : undefined,
    portHasWritable: port != null ? port.writable != null : undefined,
    fromDeviceLocked,
  };
}

/** Logs stream/port diagnostics to the renderer console (and disk log when forwarded). */
export function logMeshtasticSerialStreamDiagnostics(
  context: string,
  transport: unknown,
  port?: SerialPort | null,
): void {
  console.debug(
    `[connection] ${context} ${formatJsonForRendererLog({
      ...getMeshtasticStreamsDiagnostics(),
      ...getMeshtasticSerialStreamDiagnostics(transport, port),
    })}`,
  );
}
