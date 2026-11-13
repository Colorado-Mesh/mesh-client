import {
  LOG_SOURCE_PROTOCOL_RE,
  type LogLineLike,
  resolveLogProtocolFromChannel,
} from './logProtocolChannelResolve';
import { type MeshProtocol, REGISTERED_MESH_PROTOCOLS } from './meshProtocol';

export type { LogLineLike } from './logProtocolChannelResolve';

export type LogSurface = 'device' | 'app';

export interface LogScope {
  /** Omitted = shared (visible in every protocol tab). */
  protocol?: MeshProtocol;
  surface: LogSurface;
}

/**
 * Tag / prefix → ownership. Longest-prefix wins among keys that match the
 * leading `[…]` of the message (or a family prefix such as `[meshcoreRoom`).
 * Keys with no `protocol` are shared.
 */
export const LOG_TAG_SCOPE: Readonly<Record<string, LogScope>> = Object.freeze({
  // --- Meshtastic ---
  '[Meshtastic MQTT]': { protocol: 'meshtastic', surface: 'app' },
  '[MeshtasticMqttClientProxyBridge]': { protocol: 'meshtastic', surface: 'app' },
  '[MeshtasticRemoteAdmin]': { protocol: 'meshtastic', surface: 'app' },
  '[Meshtastic]': { protocol: 'meshtastic', surface: 'app' },
  '[meshtasticSdkRoutingErrorLog]': { protocol: 'meshtastic', surface: 'device' },
  '[meshtasticTransportLoss]': { protocol: 'meshtastic', surface: 'device' },
  '[meshtasticTransportSideEffects]': { protocol: 'meshtastic', surface: 'device' },
  '[meshtasticRuntimeWireEffects]': { protocol: 'meshtastic', surface: 'device' },
  '[meshtasticModulePortSideEffects]': { protocol: 'meshtastic', surface: 'device' },
  '[meshtasticNodeSideEffects]': { protocol: 'meshtastic', surface: 'device' },
  '[meshtasticNodeRenumber]': { protocol: 'meshtastic', surface: 'device' },
  '[meshtasticRawPacketSideEffects]': { protocol: 'meshtastic', surface: 'device' },
  '[meshtasticRouterSideEffects]': { protocol: 'meshtastic', surface: 'device' },
  '[meshtasticPhoneApiDisconnect]': { protocol: 'meshtastic', surface: 'device' },
  '[meshtasticStoreForwardPlusPlus]': { protocol: 'meshtastic', surface: 'device' },
  '[meshtasticStoreForwardSideEffects]': { protocol: 'meshtastic', surface: 'device' },
  '[meshtasticKeyVerification]': { protocol: 'meshtastic', surface: 'device' },
  '[meshtasticMqttChatNormalize]': { protocol: 'meshtastic', surface: 'app' },
  '[meshBeaconCodec]': { protocol: 'meshtastic', surface: 'device' },
  '[remoteShell]': { protocol: 'meshtastic', surface: 'app' },
  '[remoteShellSession]': { protocol: 'meshtastic', surface: 'app' },
  '[useMeshtasticRuntime]': { protocol: 'meshtastic', surface: 'device' },
  '[iMeshDevice]': { protocol: 'meshtastic', surface: 'device' },
  '[TransportSidecarGatt]': { protocol: 'meshtastic', surface: 'device' },
  '[GATT:meshtastic]': { protocol: 'meshtastic', surface: 'device' },
  '[IpcSidecarGattConnection:meshtastic]': { protocol: 'meshtastic', surface: 'device' },

  // --- MeshCore ---
  '[MeshCore MQTT]': { protocol: 'meshcore', surface: 'app' },
  '[MeshCoreTransport]': { protocol: 'meshcore', surface: 'app' },
  '[MeshCoreProtocol]': { protocol: 'meshcore', surface: 'app' },
  '[MeshcoreCompanionCliSection]': { protocol: 'meshcore', surface: 'app' },
  '[MeshcoreRemoteCliSection]': { protocol: 'meshcore', surface: 'app' },
  '[MeshcoreTelemetryPrivacySection]': { protocol: 'meshcore', surface: 'app' },
  '[meshcoreRoom': { protocol: 'meshcore', surface: 'app' },
  '[meshcoreRepeater': { protocol: 'meshcore', surface: 'app' },
  '[meshcoreClearRepeaters]': { protocol: 'meshcore', surface: 'app' },
  '[meshcoreContactCapacityPush]': { protocol: 'meshcore', surface: 'app' },
  '[meshcoreDmAckRuntime]': { protocol: 'meshcore', surface: 'device' },
  '[meshcoreHookPreamble]': { protocol: 'meshcore', surface: 'device' },
  '[meshcoreLiveContactPersist]': { protocol: 'meshcore', surface: 'device' },
  '[meshcorePathUpdatedRuntime]': { protocol: 'meshcore', surface: 'device' },
  '[meshcorePubKeyRegistry]': { protocol: 'meshcore', surface: 'device' },
  '[meshcoreRfRxRuntime]': { protocol: 'meshcore', surface: 'device' },
  '[meshcoreSerialTransportLoss]': { protocol: 'meshcore', surface: 'device' },
  '[meshcoreWaitingMessagesSyncState]': { protocol: 'meshcore', surface: 'device' },
  '[resolveMeshcoreNodePubKey]': { protocol: 'meshcore', surface: 'device' },
  '[useMeshcoreCompanionCli]': { protocol: 'meshcore', surface: 'app' },
  '[useMeshcoreCompanionRemote]': { protocol: 'meshcore', surface: 'app' },
  '[useMeshcoreTelemetryPush]': { protocol: 'meshcore', surface: 'app' },
  '[useMeshcoreRuntime]': { protocol: 'meshcore', surface: 'device' },
  '[meshcoreConnSideEffects]': { protocol: 'meshcore', surface: 'device' },
  '[BLE:meshcore]': { protocol: 'meshcore', surface: 'device' },
  '[GATT:meshcore]': { protocol: 'meshcore', surface: 'device' },
  '[IpcSidecarGattConnection:meshcore]': { protocol: 'meshcore', surface: 'device' },

  // --- Reticulum ---
  '[ReticulumSidecar]': { protocol: 'reticulum', surface: 'device' },
  '[ReticulumIPC]': { protocol: 'reticulum', surface: 'device' },
  '[ReticulumNetworkPanel]': { protocol: 'reticulum', surface: 'device' },
  '[Reticulum]': { protocol: 'reticulum', surface: 'device' },
  '[reticulumSidecarWatchdog]': { protocol: 'reticulum', surface: 'device' },
  '[reticulumSidecarReads]': { protocol: 'reticulum', surface: 'device' },
  '[useReticulumRuntime]': { protocol: 'reticulum', surface: 'device' },
  '[useReticulumSidecarApi]': { protocol: 'reticulum', surface: 'device' },
  '[IdentitySlotsSection]': { protocol: 'reticulum', surface: 'device' },
  '[applyReticulumOutboundDeliveryStatus]': { protocol: 'reticulum', surface: 'app' },
  '[catchUpRecentInboundLxmf]': { protocol: 'reticulum', surface: 'app' },
  '[createReticulumPaperMessage]': { protocol: 'reticulum', surface: 'app' },
  '[fetchRecentInboundLxmf]': { protocol: 'reticulum', surface: 'app' },
  '[handleReticulumQrIngest]': { protocol: 'reticulum', surface: 'app' },
  '[interfaceProfiles]': { protocol: 'reticulum', surface: 'app' },
  '[prepareReticulumAttachments]': { protocol: 'reticulum', surface: 'app' },
  '[reticulum-db]': { protocol: 'reticulum', surface: 'app' },
  '[reticulumAttachmentCache]': { protocol: 'reticulum', surface: 'app' },
  '[reticulumAudioAttachmentCache]': { protocol: 'reticulum', surface: 'app' },
  '[reticulumAutoResend]': { protocol: 'reticulum', surface: 'app' },
  '[reticulumDefaultHubPresets]': { protocol: 'reticulum', surface: 'app' },
  '[reticulumGamesSession]': { protocol: 'reticulum', surface: 'app' },
  '[reticulumPhotoEncode]': { protocol: 'reticulum', surface: 'app' },
  '[reticulumPropagationAutoApply]': { protocol: 'reticulum', surface: 'app' },
  '[reticulumProxyRateLimit]': { protocol: 'reticulum', surface: 'app' },
  '[reticulumRmapDiscovery]': { protocol: 'reticulum', surface: 'app' },
  '[reticulumStaleAlternateDismiss]': { protocol: 'reticulum', surface: 'app' },
  '[reticulumVoiceMemo]': { protocol: 'reticulum', surface: 'app' },
  '[sendReticulumAttachments]': { protocol: 'reticulum', surface: 'app' },
  '[sendReticulumChatMessage]': { protocol: 'reticulum', surface: 'app' },
  '[sendReticulumVoiceMemo]': { protocol: 'reticulum', surface: 'app' },
  '[useReticulumInterfaceSnapshot]': { protocol: 'reticulum', surface: 'app' },
  '[useReticulumPropagationAutoSync]': { protocol: 'reticulum', surface: 'app' },
  '[voicePcmCapture]': { protocol: 'reticulum', surface: 'app' },
  '[reticulumLocalInterfaceLogging]': { protocol: 'reticulum', surface: 'device' },
  '[reticulumBleAdapterLease]': { protocol: 'reticulum', surface: 'device' },

  // --- Shared (explicit so the scanner can see the decision) ---
  '[GATT]': { surface: 'device' },
  '[GATT:': { surface: 'device' },
  '[GATT:all]': { surface: 'device' },
  '[BLE:': { surface: 'device' },
  '[IpcSidecarGattConnection:': { surface: 'device' },
  '[Connection]': { surface: 'device' },
  '[connection]': { surface: 'device' },
  '[db]': { surface: 'app' },
  '[dbPersistRetry]': { surface: 'app' },
  '[updater]': { surface: 'app' },
  '[offline-maps]': { surface: 'app' },
  '[gps]': { surface: 'app' },
  '[TakServer]': { surface: 'app' },
  '[TakRemote]': { surface: 'app' },
  '[mecp-received-log]': { surface: 'app' },
  '[main]': { surface: 'app' },
  '[vault:': { surface: 'app' },
  '[IPC]': { surface: 'app' },
  '[ai]': { surface: 'app' },
  // Coexistence / ambiguous reticulum lowercase tag — shared until message says otherwise
  '[reticulum]': { surface: 'app' },
});

const SCOPE_KEYS_BY_LENGTH: readonly string[] = Object.freeze(
  Object.keys(LOG_TAG_SCOPE).sort((a, b) => b.length - a.length),
);

/** Leading tag or tag-prefix from a log message (`[Foo]` / `[Foo:bar]` / `[meshcoreRoom…`). */
export function extractLeadingLogTag(message: string): string | undefined {
  const m = /^\[([^\]]+)\]/.exec(message);
  if (!m?.[1]) return undefined;
  const inner = m[1];
  const colon = inner.indexOf(':');
  if (colon >= 0) {
    return `[${inner.slice(0, colon + 1)}`;
  }
  return `[${inner}]`;
}

function matchRegistryScope(message: string): LogScope | undefined {
  for (const key of SCOPE_KEYS_BY_LENGTH) {
    if (message.includes(key)) {
      return LOG_TAG_SCOPE[key];
    }
  }
  return undefined;
}

/**
 * Owning radio stack for a line. Returns undefined for shared / unattributable lines.
 * Never guesses Meshtastic for bare transport tags.
 * Channel/session heuristics live in {@link resolveLogProtocolFromChannel} (main-safe);
 * this layer adds the tag registry used by the renderer panel and analyzer.
 */
export function resolveLogProtocol(line: LogLineLike): MeshProtocol | undefined {
  const fromChannel = resolveLogProtocolFromChannel(line);
  if (fromChannel) return fromChannel;

  const scope = matchRegistryScope(line.message);
  return scope?.protocol;
}

/** Surface for a line; unregistered tags default to `app` so nothing disappears. */
export function resolveLogSurface(line: LogLineLike): LogSurface {
  const scope = matchRegistryScope(line.message);
  if (scope) return scope.surface;

  if (line.source === 'sdk') return 'device';
  // Untagged lines whose source encodes a stack name are device traffic (dev / runtime).
  if (LOG_SOURCE_PROTOCOL_RE.test(line.source)) return 'device';

  if (
    /\[GATT(?::|\])/.test(line.message) ||
    line.message.includes('[BLE:') ||
    line.message.includes('[IpcSidecarGattConnection:') ||
    line.message.includes('[Connection]')
  ) {
    return 'device';
  }

  return 'app';
}

/** True when the line belongs to a protocol other than `active`. */
export function isOwnedByOther(line: LogLineLike, active: MeshProtocol): boolean {
  const owner = resolveLogProtocol(line);
  return owner != null && owner !== active;
}

/** True when the line is owned by `protocol` (not shared). */
export function isOwnedBy(line: LogLineLike, protocol: MeshProtocol): boolean {
  return resolveLogProtocol(line) === protocol;
}

/** Device-surface lines for the active tab (shared device lines included). */
export function isDeviceLogLine(line: LogLineLike, protocol?: MeshProtocol): boolean {
  if (resolveLogSurface(line) !== 'device') return false;
  if (protocol == null) return true;
  return !isOwnedByOther(line, protocol);
}

/** App-surface exclusive tags owned by `protocol`. */
export function isProtocolExclusiveAppLogLine(line: LogLineLike, protocol: MeshProtocol): boolean {
  return resolveLogSurface(line) === 'app' && resolveLogProtocol(line) === protocol;
}

/** App log lines for the active protocol tab (shared app lines included). */
export function isAppLogLine(line: LogLineLike, protocol?: MeshProtocol): boolean {
  if (protocol) {
    return resolveLogSurface(line) === 'app' && !isOwnedByOther(line, protocol);
  }
  // No protocol: non-device lines only (exclude every registered device surface).
  return resolveLogSurface(line) !== 'device';
}

/** Registry keys for scanners (frozen copy). */
export function listLogTagScopeKeys(): readonly string[] {
  return SCOPE_KEYS_BY_LENGTH;
}

export function registeredProtocols(): readonly MeshProtocol[] {
  return REGISTERED_MESH_PROTOCOLS;
}
