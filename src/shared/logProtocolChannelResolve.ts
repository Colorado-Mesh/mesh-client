import { isMeshProtocol, type MeshProtocol } from './meshProtocol';

/**
 * Minimal log line shape for channel/message heuristics.
 * Kept separate from the tag registry so the main process can stamp ownership
 * without pulling `LOG_TAG_SCOPE` into the measured `index.js` budget.
 */
export interface LogLineLike {
  source: string;
  message: string;
  /** Explicit value already stamped by the emitter/main boundary. */
  protocol?: MeshProtocol;
}

const CONNECTION_STACK_RE = /\[Connection\].*\bstack=(meshtastic|meshcore|reticulum)\b/i;
const IPC_CHANNEL_RE = /\[IPC\]\s+(meshtastic|meshcore|reticulum)(?::|\b)/i;
const GATT_SESSION_RE = /\[GATT:(meshtastic|meshcore|reticulum|all)\]/i;
const BLE_SESSION_RE = /\[BLE:(meshtastic|meshcore|reticulum)\]/i;
const IPC_SIDECAR_RE = /\[IpcSidecarGattConnection:(meshtastic|meshcore|reticulum)\]/i;
const MAIN_GATT_SESSION_RE = /\[main\]\s+gatt:.*\bsession=(meshtastic|meshcore|reticulum)\b/i;
/** Only attribute RF auto-connect *failures*; skipped/coexistence lines stay shared. */
const RF_AUTO_CONNECT_RE =
  /^\[useProtocolRfAutoConnect\]\s+(meshtastic|meshcore|reticulum)\b(?=.*\b(?:timed out|failed|error)\b)/i;
export const LOG_SOURCE_PROTOCOL_RE = /(^|[/:.-])(meshtastic|meshcore|reticulum)([/:.-]|$)/i;

function parseProtocolToken(raw: string): MeshProtocol | undefined {
  const lower = raw.toLowerCase();
  return isMeshProtocol(lower) ? lower : undefined;
}

/**
 * Resolve ownership from explicit stamps and encoded channel/session tokens only.
 * Does not consult the tag registry (renderer/analyzer use {@link resolveLogProtocol}).
 */
export function resolveLogProtocolFromChannel(line: LogLineLike): MeshProtocol | undefined {
  if (line.protocol && isMeshProtocol(line.protocol)) {
    return line.protocol;
  }

  const { message, source } = line;

  const connection = CONNECTION_STACK_RE.exec(message);
  if (connection?.[1]) {
    const p = parseProtocolToken(connection[1]);
    if (p) return p;
  }

  const ipc = IPC_CHANNEL_RE.exec(message);
  if (ipc?.[1]) {
    const p = parseProtocolToken(ipc[1]);
    if (p) return p;
  }

  const gatt = GATT_SESSION_RE.exec(message);
  if (gatt?.[1] && gatt[1].toLowerCase() !== 'all') {
    const p = parseProtocolToken(gatt[1]);
    if (p) return p;
  }

  const ble = BLE_SESSION_RE.exec(message);
  if (ble?.[1]) {
    const p = parseProtocolToken(ble[1]);
    if (p) return p;
  }

  const sidecar = IPC_SIDECAR_RE.exec(message);
  if (sidecar?.[1]) {
    const p = parseProtocolToken(sidecar[1]);
    if (p) return p;
  }

  const mainGatt = MAIN_GATT_SESSION_RE.exec(message);
  if (mainGatt?.[1]) {
    const p = parseProtocolToken(mainGatt[1]);
    if (p) return p;
  }

  const rfAuto = RF_AUTO_CONNECT_RE.exec(message.trimStart());
  if (rfAuto?.[1]) {
    const p = parseProtocolToken(rfAuto[1]);
    if (p) return p;
  }

  if (source === 'sdk') {
    return 'meshtastic';
  }

  const sourceMatch = LOG_SOURCE_PROTOCOL_RE.exec(source);
  if (sourceMatch?.[2]) {
    const p = parseProtocolToken(sourceMatch[2]);
    if (p) return p;
  }

  return undefined;
}
