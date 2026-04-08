import { create, toBinary } from '@bufbuild/protobuf';
import type { MeshDevice } from '@meshtastic/core';
import { Admin, Channel as ProtobufChannel, Mesh, Portnums } from '@meshtastic/protobufs';
import { useCallback, useEffect, useRef, useState } from 'react';

type ChannelType = Parameters<MeshDevice['setChannel']>[0];
type PositionType = Parameters<MeshDevice['setPosition']>[0];
type UserType = Parameters<MeshDevice['setOwner']>[0];
type WaypointType = Parameters<MeshDevice['sendWaypoint']>[0];

import {
  meshtasticShortNameAfterClearingDefault,
  preferNonEmptyTrimmedString,
} from '../../shared/nodeNameUtils';
import { getAppSettingsRaw } from '../lib/appSettingsStorage';
import {
  createBleConnection,
  createConnection,
  reconnectSerial,
  safeDisconnect,
} from '../lib/connection';
import { validateCoords } from '../lib/coordUtils';
import { containsMeshCorePattern, extractRssiSnr } from '../lib/foreignLoraDetection';
import type { OurPosition } from '../lib/gpsSource';
import { resolveOurPosition } from '../lib/gpsSource';
import { parseStoredJson } from '../lib/parseStoredJson';
import { MESHTASTIC_CAPABILITIES } from '../lib/radio/BaseRadioProvider';
import { normalizeReactionEmoji } from '../lib/reactions';
import { LAST_SERIAL_PORT_KEY } from '../lib/serialPortSignature';
import { getStoredMeshProtocol } from '../lib/storedMeshProtocol';
import { TransportManager } from '../lib/transport/TransportManager';
import type { StatusUpdateEvent } from '../lib/transport/types';
import type {
  ChatMessage,
  ConnectionType,
  DeviceState,
  EnvironmentTelemetryPoint,
  MeshNeighbor,
  MeshNode,
  MeshWaypoint,
  MQTTStatus,
  NeighborInfoRecord,
  TelemetryPoint,
} from '../lib/types';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { usePositionHistoryStore } from '../stores/positionHistoryStore';

function getMessageLoadLimit(): number {
  const s = parseStoredJson<{
    messageLimitEnabled?: boolean;
    messageLimitCount?: number;
  }>(getAppSettingsRaw(), 'useDevice getMessageLoadLimit');
  if (!s) return 1000;
  if (s.messageLimitEnabled === false) return 10000;
  return Math.max(1, s.messageLimitCount ?? 1000);
}

const MAX_TELEMETRY_POINTS = 50;
const POLL_INTERVAL_MS = 30_000; // 30 seconds (BLE/serial)
const HTTP_POLL_INTERVAL_MS = 60_000; // 60 seconds for WiFi — less contention with user sends
const BROADCAST_ADDR = 0xffffffff;

// ─── Connection watchdog thresholds (per transport) ────────────────
const BLE_STALE_THRESHOLD_MS = 90_000; // 90s — show warning
const BLE_DEAD_THRESHOLD_MS = 180_000; // 3min — trigger reconnect
const SERIAL_STALE_THRESHOLD_MS = 120_000; // 2min
const SERIAL_DEAD_THRESHOLD_MS = 300_000; // 5min
// HTTP: align closer to BLE thresholds so WiFi behaves similarly for staleness/reconnect.
const HTTP_STALE_THRESHOLD_MS = 90_000; // 90s — show warning
const HTTP_DEAD_THRESHOLD_MS = 180_000; // 3min — trigger reconnect
const WATCHDOG_INTERVAL_MS = 15_000; // Check every 15s
const MAX_RECONNECT_ATTEMPTS = 5;

function getOrCreateVirtualNodeId(): number {
  const key = 'mesh-client:mqttVirtualNodeId';
  const existing = localStorage.getItem(key);
  if (existing) {
    const n = parseInt(existing, 10);
    if (n > 0 && n < 0xffffffff) return n;
  }
  let id: number;
  if (typeof window !== 'undefined') {
    const buf = new Uint32Array(1);
    window.crypto.getRandomValues(buf);
    // Limit to 0x0FFFFFFF to stay consistent with the previous range, then make it > 0
    id = (buf[0] & 0x0fffffff) + 1;
  } else {
    // Fallback: still avoid returning 0; range 1..0x0FFFFFFF
    id = ((Math.random() * 0x0fffffff) >>> 0) + 1;
  }
  localStorage.setItem(key, String(id));
  return id;
}

const MQTT_ONLY_VIRTUAL_LONG_NAME = 'MQTT-only Virtual Address';
const ROLE_CLIENT = 0;
const ROLE_CLIENT_MUTE = 1;

export function useDevice() {
  const deviceRef = useRef<MeshDevice | null>(null);
  // Track own node number in a ref so event callbacks can access it
  // without relying on the private device.myNodeInfo property
  const myNodeNumRef = useRef<number>(0);
  // Use a ref for nodes so event callbacks always see the latest value
  const nodesRef = useRef<Map<number, MeshNode>>(new Map());
  // Track polling interval for node refresh
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track event unsubscribe functions for cleanup
  const unsubscribesRef = useRef<(() => void)[]>([]);

  // ─── Connection watchdog refs ─────────────────────────────────
  const lastDataReceivedRef = useRef<number>(Date.now());
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const connectionParamsRef = useRef<{
    type: ConnectionType;
    httpAddress?: string;
    blePeripheralId?: string;
  } | null>(null);
  const isReconnectingRef = useRef<boolean>(false);
  const reconnectGenerationRef = useRef<number>(0);
  const transportManagerRef = useRef<TransportManager | null>(null);
  const onStatusUpdateRef = useRef<(event: StatusUpdateEvent) => void>(() => {});
  // Tracks the tempId of an in-flight optimistic message (device path) so the echo can be skipped
  const pendingTempIdRef = useRef<number | undefined>(undefined);
  // True while the device is in the configuring phase (replaying queued packets); messages
  // received during this window are historical and should not increment the unread counter.
  const isConfiguringRef = useRef<boolean>(false);
  const configureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── GPS tracking ─────────────────────────────────────────────
  const deviceGpsModeRef = useRef<number>(0); // 0=DISABLED,1=ENABLED,2=NOT_PRESENT
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshOurPositionRef = useRef<() => Promise<OurPosition | null>>(() =>
    Promise.resolve(null),
  );

  // ─── MQTT session tracking ────────────────────────────────────
  // Tracks current MQTT connection status in a ref for use in callbacks
  const mqttStatusRef = useRef<MQTTStatus>('disconnected');
  // Periodic NodeInfo broadcast when MQTT-only so other nodes see this client
  const mqttPresenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Initial 10-second delay before starting presence broadcasts — tracked so it can be cancelled on unmount
  const mqttPresenceInitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror channelConfigs state into a ref so MQTT callbacks don't have stale closures
  const channelConfigsRef = useRef<typeof channelConfigs>([]);
  // Nodes heard via RF this session — prevents MQTT-only flag from being set
  const rfHeardNodeIds = useRef<Set<number>>(new Set());
  // Dedup map shared between RF and MQTT handlers
  const seenPacketIds = useRef<Map<number, number>>(new Map());

  const [mqttStatus, setMqttStatus] = useState<MQTTStatus>('disconnected');
  const [ourPosition, setOurPosition] = useState<OurPosition | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [deviceGpsMode, setDeviceGpsMode] = useState<number>(0);
  const [telemetryDeviceUpdateInterval, setTelemetryDeviceUpdateInterval] = useState<number | null>(
    null,
  );

  const [state, setState] = useState<DeviceState>({
    status: 'disconnected',
    myNodeNum: 0,
    connectionType: null,
  });
  const [deviceOwner, setDeviceOwner] = useState<{
    longName: string;
    shortName: string;
    isLicensed: boolean;
  } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nodes, setNodes] = useState<Map<number, MeshNode>>(new Map());
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const [signalTelemetry, setSignalTelemetry] = useState<TelemetryPoint[]>([]);
  const [environmentTelemetry, setEnvironmentTelemetry] = useState<EnvironmentTelemetryPoint[]>([]);
  const [traceRouteResults, setTraceRouteResults] = useState<
    Map<number, { route: number[]; from: number; timestamp: number }>
  >(new Map());
  const [channels, setChannels] = useState<{ index: number; name: string }[]>([
    { index: 0, name: 'Primary' },
  ]);
  const [channelConfigs, setChannelConfigs] = useState<
    {
      index: number;
      name: string;
      role: number;
      psk: Uint8Array;
      uplinkEnabled: boolean;
      downlinkEnabled: boolean;
      positionPrecision: number;
    }[]
  >([]);

  const [queueStatus, setQueueStatus] = useState<{
    free: number;
    maxlen: number;
    res: number;
  } | null>(null);
  const [deviceLogs, setDeviceLogs] = useState<
    { message: string; time: number; source: string; level: number }[]
  >([]);
  const [neighborInfo, setNeighborInfo] = useState<Map<number, NeighborInfoRecord>>(new Map());
  const [waypoints, setWaypoints] = useState<Map<number, MeshWaypoint>>(new Map());
  const [moduleConfigs, setModuleConfigs] = useState<Record<string, unknown>>({});
  const [securityConfig, setSecurityConfig] = useState<{
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    adminKey: Uint8Array[];
    isManaged: boolean;
    serialEnabled: boolean;
    debugLogApiEnabled: boolean;
    adminChannelEnabled: boolean;
  } | null>(null);

  // ─── Additional packet type state ─────────────────────────────────
  const [remoteHardwareMessages, setRemoteHardwareMessages] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [audioMessages, setAudioMessages] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [detectionSensorEvents, setDetectionSensorEvents] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [pingResponses, setPingResponses] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }>
  >(new Map());
  const [ipTunnelMessages, setIpTunnelMessages] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [paxCounterData, setPaxCounterData] = useState<
    Map<number, { from: number; count: number; timestamp: number }>
  >(new Map());
  const [serialMessages, setSerialMessages] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [storeForwardMessages, setStoreForwardMessages] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [rangeTestPackets, setRangeTestPackets] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [zpsMessages, setZpsMessages] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [simulatorPackets, setSimulatorPackets] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [atakMessages, setAtakMessages] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [mapReports, setMapReports] = useState<
    Map<number, { from: number; data: unknown; timestamp: number }>
  >(new Map());
  const [privateMessages, setPrivateMessages] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());

  // Keep nodesRef in sync with state
  const updateNodes = useCallback(
    (updater: (prev: Map<number, MeshNode>) => Map<number, MeshNode>) => {
      setNodes((prev) => {
        const next = updater(prev);
        nodesRef.current = next;
        return next;
      });
    },
    [],
  );

  const ensureNodeExists = useCallback(
    (nodeNum: number, source: 'rf' | 'mqtt') => {
      if (nodesRef.current.has(nodeNum) || nodeNum === 0) return;
      updateNodes((prev) => {
        if (prev.has(nodeNum)) return prev;
        const created = createChatStubNode(nodeNum, source);
        const next = new Map(prev);
        next.set(nodeNum, created);
        void window.electronAPI.db.saveNode(created);
        return next;
      });
    },
    [updateNodes],
  );

  // Keep channelConfigsRef in sync so MQTT callbacks always see current config
  useEffect(() => {
    channelConfigsRef.current = channelConfigs;
  }, [channelConfigs]);

  // ─── Packet dedup helper (shared by RF and MQTT handlers) ──────
  const isDuplicate = useCallback((packetId: number): boolean => {
    const now = Date.now();
    const expiry = seenPacketIds.current.get(packetId);
    if (expiry !== undefined && expiry > now) return true;
    seenPacketIds.current.set(packetId, now + 10 * 60 * 1000);
    // Periodic cleanup to prevent unbounded growth
    if (seenPacketIds.current.size > 5_000) {
      for (const [id, exp] of seenPacketIds.current) {
        if (exp < now) seenPacketIds.current.delete(id);
      }
    }
    return false;
  }, []);

  // Compact display name: short_name, truncated long_name, or hex ID
  const getNodeName = useCallback((nodeNum: number): string => {
    const node = nodesRef.current.get(nodeNum);
    if (node?.short_name) return node.short_name;
    if (node?.long_name)
      return node.long_name.length > 7 ? node.long_name.slice(0, 7) : node.long_name;
    return `!${nodeNum.toString(16).padStart(8, '0')}`;
  }, []);

  // Picker-style label: "icon_XXXX" (same format as BLE picker). If short_name
  // already ends with _ + 4 hex digits, use it; else append _ + last 4 hex of node ID.
  const getPickerStyleNodeLabel = useCallback((nodeNum: number): string => {
    const node = nodesRef.current.get(nodeNum);
    const fourHex = nodeNum.toString(16).slice(-4);
    if (node?.short_name) {
      if (/_[0-9a-fA-F]{4}$/.test(node.short_name)) return node.short_name;
      return `${node.short_name}_${fourHex}`;
    }
    if (node?.long_name)
      return node.long_name.length > 7
        ? `${node.long_name.slice(0, 7)}_${fourHex}`
        : `${node.long_name}_${fourHex}`;
    return `!${nodeNum.toString(16)}`;
  }, []);

  // Extended label: short_name + hex suffix, long_name, or hex fallback.
  // Used in the header for the connected node display.
  const getFullNodeLabel = useCallback((nodeNum: number): string => {
    const node = nodesRef.current.get(nodeNum);
    const hexId = `!${nodeNum.toString(16)}`;
    if (node?.short_name) {
      // Avoid double-appending hex if short_name already contains it
      return node.short_name.includes(hexId) ? node.short_name : `${node.short_name} ${hexId}`;
    }
    if (node?.long_name) return node.long_name;
    return hexId;
  }, []);

  // ─── Mark data as freshly received ────────────────────────────
  const touchLastData = useCallback(() => {
    lastDataReceivedRef.current = Date.now();
    // If we were in "stale" state, recover to "configured"
    setState((s) => {
      if (s.status === 'stale') {
        console.debug('[useDevice] watchdog: recovered from stale → configured');
        return { ...s, status: 'configured', lastDataReceived: Date.now() };
      }
      return s;
    });
  }, []);

  /** Meshtastic `DeviceMetrics.batteryLevel`: 0–100; values above 100 mean USB powered (protobuf). */
  const applyOwnNodeBatteryFromDeviceMetrics = useCallback((batteryLevel: number) => {
    const charging = batteryLevel > 100;
    const pct = Math.min(100, batteryLevel);
    setState((s) => ({ ...s, batteryPercent: pct, batteryCharging: charging }));
  }, []);

  // ─── Helper: start polling for node updates ─────────────────────
  const startPolling = useCallback((connectionType?: ConnectionType | null) => {
    if (pollRef.current) return; // Already polling
    const intervalMs = connectionType === 'http' ? HTTP_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
    pollRef.current = setInterval(() => {
      if (nodesRef.current.get(myNodeNumRef.current)?.role === ROLE_CLIENT_MUTE) return;
      deviceRef.current?.requestPosition(0xffffffff).catch((e: unknown) => {
        console.debug('[useDevice] requestPosition poll', e);
      });
    }, intervalMs);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // ─── Helper: clean up all event subscriptions ───────────────────
  const cleanupSubscriptions = useCallback(() => {
    for (const unsub of unsubscribesRef.current) {
      try {
        unsub();
      } catch (e) {
        console.debug('[useDevice] unsubscribe error (ignored)', e);
      }
    }
    unsubscribesRef.current = [];
  }, []);

  const clearConfigureTimeout = useCallback(() => {
    if (configureTimeoutRef.current) {
      clearTimeout(configureTimeoutRef.current);
      configureTimeoutRef.current = null;
    }
  }, []);

  // ─── Watchdog: get thresholds per transport type ──────────────
  const getThresholds = useCallback(() => {
    const type = connectionParamsRef.current?.type;
    switch (type) {
      case 'ble':
        return { stale: BLE_STALE_THRESHOLD_MS, dead: BLE_DEAD_THRESHOLD_MS };
      case 'serial':
        return { stale: SERIAL_STALE_THRESHOLD_MS, dead: SERIAL_DEAD_THRESHOLD_MS };
      case 'http':
        return { stale: HTTP_STALE_THRESHOLD_MS, dead: HTTP_DEAD_THRESHOLD_MS };
      default:
        return { stale: 90_000, dead: 180_000 };
    }
  }, []);

  // ─── Watchdog: stop watchdog ──────────────────────────────────
  const stopWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  // ─── GPS interval management ───────────────────────────────────
  const stopGpsInterval = useCallback(() => {
    if (gpsIntervalRef.current) {
      clearInterval(gpsIntervalRef.current);
      gpsIntervalRef.current = null;
    }
  }, []);

  const startGpsInterval = useCallback(() => {
    stopGpsInterval();
    try {
      const gpsParsed = parseStoredJson<{ refreshInterval?: number }>(
        localStorage.getItem('mesh-client:gpsSettings'),
        'useDevice startGpsInterval',
      );
      const intervalSecs = gpsParsed?.refreshInterval ?? 0;
      if (intervalSecs > 0) {
        gpsIntervalRef.current = setInterval(() => {
          refreshOurPositionRef.current().catch((err: unknown) => {
            console.error('[useDevice] GPS interval refresh error:', err);
          });
        }, intervalSecs * 1000);
      }
    } catch {
      // catch-no-log-ok localStorage read for GPS interval setting — ignore parse errors
    }
  }, [stopGpsInterval]);

  // ─── Forward declarations for mutual recursion ────────────────
  const handleConnectionLostRef = useRef<() => void>(() => {});
  const attemptReconnectRef = useRef<() => Promise<void>>(async () => {});

  // ─── Watchdog: start monitoring data freshness ────────────────
  const startWatchdog = useCallback(() => {
    if (watchdogRef.current) return;
    watchdogRef.current = setInterval(() => {
      if (isReconnectingRef.current) return;
      const elapsed = Date.now() - lastDataReceivedRef.current;
      const { stale, dead } = getThresholds();
      const transport = connectionParamsRef.current?.type ?? 'unknown';
      if (elapsed > dead) {
        console.warn(
          `[useDevice] watchdog: ${transport} dead for ${elapsed}ms, triggering reconnect`,
        );
        handleConnectionLostRef.current();
      } else if (elapsed > stale) {
        console.warn(`[useDevice] watchdog: ${transport} stale for ${elapsed}ms`);
        setState((s) => {
          if (s.status === 'configured' || s.status === 'connected') {
            return { ...s, status: 'stale', lastDataReceived: lastDataReceivedRef.current };
          }
          return s;
        });
      }
    }, WATCHDOG_INTERVAL_MS);
  }, [getThresholds]);

  // Load saved data from DB on mount
  useEffect(() => {
    window.electronAPI.db
      .getMessages(undefined, getMessageLoadLimit())
      .then((msgs) => {
        const reversed = msgs.reverse();
        setMessages(reversed);
        // Seed dedup map so device config-sync replays are caught immediately
        for (const m of reversed) {
          if (m.packetId) {
            seenPacketIds.current.set(m.packetId, Date.now() + 10 * 60 * 1000);
          }
        }
      })
      .catch((err: unknown) => {
        console.error('[useDevice] Failed to load messages:', err);
        setMessages([]);
      });
    window.electronAPI.db
      .getNodes()
      .then((savedNodes) => {
        const nodeMap = new Map<number, MeshNode>();
        for (const n of savedNodes) {
          const long_name = n.long_name ?? '';
          nodeMap.set(n.node_id, {
            ...n,
            long_name,
            short_name: meshtasticShortNameAfterClearingDefault(
              long_name,
              n.short_name ?? '',
              n.node_id,
            ),
            role: parseNodeRole(n.role),
            favorited: Boolean(n.favorited),
            // Restore MQTT-only status from persisted source so these nodes show
            // the globe indicator and suppressed hop count until heard via RF.
            heard_via_mqtt_only: n.source === 'mqtt',
          });
        }
        nodesRef.current = nodeMap;
        setNodes(nodeMap);
      })
      .catch((err: unknown) => {
        console.error('[useDevice] Failed to load nodes:', err);
      });
  }, []);

  // ─── MQTT event subscriptions (independent of RF device) ──────
  useEffect(() => {
    const unsubStatus = window.electronAPI.mqtt.onStatus(({ status: s, protocol }) => {
      if (protocol !== 'meshtastic') return;
      mqttStatusRef.current = s;
      setMqttStatus(s);
      if (s !== 'connected') {
        setMessages((prev) =>
          prev.map((m) =>
            m.mqttStatus === 'sending' ? { ...m, mqttStatus: 'failed' as const } : m,
          ),
        );
      }
      if (s === 'connected' && !deviceRef.current) {
        startGpsInterval();
        const virtualId = getOrCreateVirtualNodeId();
        updateNodes((prev) => {
          const updated = new Map(prev);
          const existing = updated.get(virtualId) ?? emptyNode(virtualId);
          updated.set(virtualId, {
            ...existing,
            node_id: virtualId,
            long_name: MQTT_ONLY_VIRTUAL_LONG_NAME,
            role: ROLE_CLIENT,
            hops_away: 0,
          });
          return updated;
        });
        // Periodic NodeInfo broadcast so other nodes see this client (every 5 min)
        if (mqttPresenceIntervalRef.current) clearInterval(mqttPresenceIntervalRef.current);
        const sendPresence = () => {
          if (deviceRef.current || mqttStatusRef.current !== 'connected') {
            if (mqttPresenceIntervalRef.current) {
              clearInterval(mqttPresenceIntervalRef.current);
              mqttPresenceIntervalRef.current = null;
            }
            return;
          }
          window.electronAPI.mqtt
            .publishNodeInfo({
              from: getOrCreateVirtualNodeId(),
              longName: MQTT_ONLY_VIRTUAL_LONG_NAME,
              shortName: 'MQTT',
              channelName: 'LongFast',
            })
            .catch((e: unknown) => {
              console.warn('[useDevice] MQTT presence publish failed', e);
            });
        };
        if (mqttPresenceInitTimerRef.current) clearTimeout(mqttPresenceInitTimerRef.current);
        mqttPresenceInitTimerRef.current = setTimeout(sendPresence, 10_000);
        mqttPresenceIntervalRef.current = setInterval(sendPresence, 5 * 60 * 1000);
      } else if (s !== 'connected') {
        if (mqttPresenceIntervalRef.current) {
          clearInterval(mqttPresenceIntervalRef.current);
          mqttPresenceIntervalRef.current = null;
        }
      }
    });

    const unsubNode = window.electronAPI.mqtt.onNodeUpdate((rawNode) => {
      const nodeUpdate = rawNode as Partial<MeshNode> & {
        node_id: number;
        from_mqtt?: boolean;
        protocol?: 'meshtastic' | 'meshcore';
        positionWarning?: string | null;
        neighbors?: MeshNeighbor[];
      };
      if (!nodeUpdate.node_id) return;

      // Skip if protocol doesn't match current mode (backward compat: no protocol = process)
      if (nodeUpdate.protocol && nodeUpdate.protocol !== getStoredMeshProtocol()) {
        return;
      }

      console.debug(`[useDevice] MQTT node update: nodeId=${nodeUpdate.node_id}`);

      // Handle neighbor info from MQTT
      if (nodeUpdate.neighbors && nodeUpdate.neighbors.length > 0) {
        setNeighborInfo((prev) => {
          const existing = prev.get(nodeUpdate.node_id);
          // Only merge if no RF neighbor info exists
          if (existing && existing.neighbors.length > 0) {
            return prev;
          }
          const updated = new Map(prev);
          updated.set(nodeUpdate.node_id, {
            nodeId: nodeUpdate.node_id,
            neighbors: nodeUpdate.neighbors ?? [],
            timestamp: Date.now(),
          });
          return updated;
        });
      }

      updateNodes((prev) => {
        const existing = prev.get(nodeUpdate.node_id) ?? emptyNode(nodeUpdate.node_id);
        const heardViaRF = rfHeardNodeIds.current.has(nodeUpdate.node_id);
        const updated = new Map(prev);
        const node: MeshNode = {
          ...existing,
          ...nodeUpdate,
          heard_via_mqtt_only: !heardViaRF,
          heard_via_mqtt: true,
          source: heardViaRF ? 'rf' : 'mqtt',
          last_heard: nodeUpdate.last_heard ?? Date.now(),
          long_name: preferNonEmptyTrimmedString(nodeUpdate.long_name, existing.long_name, {
            nodeId: nodeUpdate.node_id,
          }),
          // Explicitly handle role to ensure it's properly updated from MQTT
          role: nodeUpdate.role ?? existing.role,
        };
        // Don't overwrite RF signal data with MQTT-sourced node data
        if (!heardViaRF) {
          // MQTT-only: suppress device-local RF metrics; hops_away from binary MQTT is valid
          node.snr = existing.snr;
          node.rssi = existing.rssi;
        }
        // Validate position if the update includes coords
        if (nodeUpdate.latitude != null || nodeUpdate.longitude != null) {
          const lat = nodeUpdate.latitude ?? 0;
          const lon = nodeUpdate.longitude ?? 0;
          const r = validateCoords(lat, lon);
          if (!r.valid) {
            node.latitude = existing.latitude;
            node.longitude = existing.longitude;
            node.lastPositionWarning = r.warning;
          } else {
            node.lastPositionWarning = undefined;
          }
        }
        // Apply positionWarning emitted by mqtt-manager (bad coords, no position change)
        if (nodeUpdate.positionWarning) {
          node.lastPositionWarning = nodeUpdate.positionWarning;
        } else if (nodeUpdate.positionWarning === null) {
          node.lastPositionWarning = undefined;
        }
        node.short_name = meshtasticShortNameAfterClearingDefault(
          node.long_name ?? '',
          node.short_name ?? '',
          node.node_id,
        );
        updated.set(nodeUpdate.node_id, node);
        void window.electronAPI.db.saveNode(node);
        return updated;
      });
      const updatedMqttNode = nodesRef.current.get(nodeUpdate.node_id);
      if (updatedMqttNode && getStoredMeshProtocol() === 'meshtastic') {
        useDiagnosticsStore
          .getState()
          .processNodeUpdate(
            updatedMqttNode,
            nodesRef.current.get(myNodeNumRef.current) ?? null,
            myNodeNumRef.current,
            MESHTASTIC_CAPABILITIES,
          );
      }
      if (nodeUpdate.latitude != null && nodeUpdate.longitude != null) {
        if (validateCoords(nodeUpdate.latitude, nodeUpdate.longitude).valid) {
          usePositionHistoryStore
            .getState()
            .recordPosition(nodeUpdate.node_id, nodeUpdate.latitude, nodeUpdate.longitude);
        }
      }
    });

    const unsubMsg = window.electronAPI.mqtt.onMessage((rawMsg) => {
      const raw = rawMsg as Omit<ChatMessage, 'id'> & { from_mqtt?: boolean };

      // Normalize placeholder replyId/emoji (some senders emit 0 instead of omitting the field)
      const cleanedReplyId = raw.replyId != null && raw.replyId !== 0 ? raw.replyId : undefined;
      const cleanedEmoji = raw.emoji != null && raw.emoji !== 0 ? raw.emoji : undefined;

      let cleanedPayload = raw.payload;
      if (typeof cleanedPayload === 'string') {
        const trimmed = cleanedPayload.trim();
        if (trimmed === '0') {
          // Strip leading "0" payloads that are just a placeholder from buggy senders
          cleanedPayload = '';
        }
      }

      const baseMsg: Omit<ChatMessage, 'id'> & { from_mqtt?: boolean } = {
        ...raw,
        payload: cleanedPayload,
        replyId: cleanedReplyId,
        emoji: cleanedEmoji,
      };

      const msg: Omit<ChatMessage, 'id'> & { from_mqtt?: boolean } =
        baseMsg.emoji != null && baseMsg.replyId != null
          ? {
              ...baseMsg,
              emoji: normalizeReactionEmoji(baseMsg.emoji, baseMsg.payload) ?? baseMsg.emoji,
            }
          : baseMsg;

      if (msg.sender_id) {
        ensureNodeExists(msg.sender_id, 'mqtt');
      }
      // Record MQTT path before dedup check (captures all copies, new and duplicate). Skip packetId 0 (no unique id per protobuf).
      const rawPacketId = Number(msg.packetId);
      const packetId = rawPacketId >>> 0;
      if (
        getStoredMeshProtocol() === 'meshtastic' &&
        msg.sender_id &&
        Number.isInteger(rawPacketId) &&
        packetId !== 0
      ) {
        useDiagnosticsStore.getState().recordPacketPath(packetId, msg.sender_id, {
          transport: 'mqtt',
          timestamp: Date.now(),
        });
      }

      // Packet ID dedup (catches our own uplink echoes)
      console.debug(`[useDevice] MQTT message: from=${msg.sender_id} packetId=${packetId}`);
      if (packetId !== 0 && isDuplicate(packetId)) {
        if (getStoredMeshProtocol() === 'meshtastic') {
          useDiagnosticsStore.getState().recordDuplicate(msg.sender_id);
        }
        // Upgrade receivedVia to 'both' if this packet was already saved via RF
        setMessages((prev) =>
          prev.map((m) =>
            m.packetId === packetId && m.receivedVia === 'rf'
              ? { ...m, receivedVia: 'both' as const }
              : m,
          ),
        );
        if (packetId !== 0) void window.electronAPI.db.updateMessageReceivedVia(packetId);
        return;
      }

      // Deduplicate by content too (same sender + timestamp)
      const mqttMsg = { ...msg, receivedVia: 'mqtt' as const };
      setMessages((prev) => {
        const isDup = prev.some(
          (m) =>
            m.sender_id === mqttMsg.sender_id &&
            m.timestamp === mqttMsg.timestamp &&
            m.payload === mqttMsg.payload,
        );
        if (isDup) return prev;
        return [...prev, mqttMsg];
      });
      void window.electronAPI.db.saveMessage(mqttMsg);
    });

    return () => {
      unsubStatus();
      unsubNode();
      unsubMsg();
      if (mqttPresenceInitTimerRef.current) {
        clearTimeout(mqttPresenceInitTimerRef.current);
        mqttPresenceInitTimerRef.current = null;
      }
      if (mqttPresenceIntervalRef.current) {
        clearInterval(mqttPresenceIntervalRef.current);
        mqttPresenceIntervalRef.current = null;
      }
    };
  }, [updateNodes, isDuplicate, startGpsInterval, ensureNodeExists]);

  // Cleanup on unmount — stop all intervals and subscriptions
  useEffect(() => {
    return () => {
      cleanupSubscriptions();
      clearConfigureTimeout();
      stopPolling();
      stopWatchdog();
      stopGpsInterval();
      isReconnectingRef.current = false;
      const device = deviceRef.current;
      deviceRef.current = null;
      if (device) {
        safeDisconnect(device).catch((e: unknown) => {
          console.debug('[useDevice] unmount safeDisconnect', e);
        });
      }
    };
  }, [cleanupSubscriptions, clearConfigureTimeout, stopPolling, stopWatchdog, stopGpsInterval]);

  // ─── Wire up all event subscriptions for a device ─────────────
  const wireSubscriptions = useCallback(
    (device: MeshDevice, type: ConnectionType) => {
      // ─── Device status ─────────────────────────────────────────
      const unsub1 = device.events.onDeviceStatus.subscribe((status) => {
        touchLastData();
        const statusMap: Record<number, DeviceState['status']> = {
          1: 'connecting', // DeviceRestarting
          2: 'disconnected', // DeviceDisconnected
          3: 'connecting', // DeviceConnecting
          4: 'connecting', // DeviceReconnecting
          5: 'connected', // DeviceConnected
          6: 'connecting', // DeviceConfiguring
          7: 'configured', // DeviceConfigured
        };
        const mapped = statusMap[status] ?? 'connected';
        setState((s) => ({ ...s, status: mapped }));

        // Track configuring phase so packet replays are marked as historical
        if (status === 3 || status === 5 || status === 6) {
          isConfiguringRef.current = true;
          if (status === 6 && type === 'ble' && !configureTimeoutRef.current) {
            configureTimeoutRef.current = setTimeout(() => {
              console.warn('[useDevice] configure timeout (BLE 30s) — forcing disconnect');
              const activeDevice = deviceRef.current;
              deviceRef.current = null;
              if (activeDevice) {
                void safeDisconnect(activeDevice).catch((e: unknown) => {
                  console.debug('[useDevice] configure timeout safeDisconnect', e);
                });
              }
              cleanupSubscriptions();
              stopPolling();
              stopWatchdog();
              stopGpsInterval();
              setState({
                status: 'disconnected',
                myNodeNum: 0,
                connectionType: null,
                batteryPercent: undefined,
                batteryCharging: undefined,
              });
              clearConfigureTimeout();
            }, 30000);
          }
        }

        // Start polling + watchdog when configured
        if (status === 7) {
          clearConfigureTimeout();
          isConfiguringRef.current = false;
          lastDataReceivedRef.current = Date.now();
          startPolling(type);
          startWatchdog();
          void refreshOurPositionRef.current();
          startGpsInterval();
        }

        // Always clean up on disconnect, even if we never reached configured
        if (status === 2) {
          clearConfigureTimeout();
          isConfiguringRef.current = false;
          stopWatchdog();
          stopGpsInterval();
          cleanupSubscriptions();
          stopPolling();
          setTraceRouteResults(new Map());
          setQueueStatus(null);
          setDeviceLogs([]);
          usePositionHistoryStore.getState().clearHistory();
          setNeighborInfo(new Map());
          setWaypoints(new Map());
          setModuleConfigs({});
          setSecurityConfig(null);
          deviceRef.current = null;
          setState((s) => ({
            ...s,
            status: 'disconnected',
            connectionType: null,
            firmwareVersion: undefined,
            batteryPercent: undefined,
            batteryCharging: undefined,
          }));
        }
      });
      unsubscribesRef.current.push(unsub1);

      // ─── My node info ──────────────────────────────────────────
      const unsub2 = device.events.onMyNodeInfo.subscribe((info) => {
        console.debug(`[useDevice] onMyNodeInfo: myNodeNum=${info.myNodeNum}`);
        touchLastData();
        const virtualNodeId = getOrCreateVirtualNodeId();
        if (virtualNodeId !== info.myNodeNum) {
          window.electronAPI.db.deleteNode(virtualNodeId).catch((e: unknown) => {
            console.debug('[useDevice] deleteNode virtual', e);
          });
        }
        myNodeNumRef.current = info.myNodeNum;
        if (getStoredMeshProtocol() === 'meshtastic') {
          useDiagnosticsStore.getState().migrateForeignLoraFromZero(info.myNodeNum);
        }
        setState((s) => ({
          ...s,
          myNodeNum: info.myNodeNum,
          batteryPercent: undefined,
          batteryCharging: undefined,
        }));
        updateNodes((prev) => {
          const updated = new Map(prev);
          if (virtualNodeId !== info.myNodeNum) updated.delete(virtualNodeId);
          const existing = updated.get(info.myNodeNum);
          if (!existing) {
            const selfNode = { ...emptyNode(info.myNodeNum), hops_away: 0, last_heard: Date.now() };
            updated.set(info.myNodeNum, selfNode);
          } else {
            const selfNode = { ...existing, hops_away: 0 };
            updated.set(info.myNodeNum, selfNode);
            void window.electronAPI.db.saveNode(selfNode);
          }
          return updated;
        });
      });
      unsubscribesRef.current.push(unsub2);

      // ─── Device metadata (firmware version) ────────────────────
      const unsub_meta = device.events.onDeviceMetadataPacket.subscribe((packet) => {
        const ver = packet.data.firmwareVersion;
        if (ver) setState((s) => ({ ...s, firmwareVersion: ver }));
      });
      unsubscribesRef.current.push(unsub_meta);

      // ─── Text messages ─────────────────────────────────────────
      const unsub3 = device.events.onMeshPacket.subscribe((meshPacket) => {
        if (meshPacket.payloadVariant.case !== 'decoded') return;
        const dataPacket = meshPacket.payloadVariant.value;
        if (dataPacket.portnum !== Portnums.PortNum.TEXT_MESSAGE_APP) return;

        ensureNodeExists(meshPacket.from, 'rf');

        // Bump last_heard for the sender on live (non-replay) packets.
        if (!isConfiguringRef.current && meshPacket.from) {
          updateNodes((prev) => {
            const existing = prev.get(meshPacket.from);
            if (!existing) return prev;
            const now = meshPacket.rxTime ? meshPacket.rxTime * 1000 : Date.now();
            if (now <= (existing.last_heard || 0)) return prev;
            const next = new Map(prev);
            const updated = { ...existing, last_heard: now };
            next.set(meshPacket.from, updated);
            void window.electronAPI.db.saveNode(updated);
            return next;
          });
        }

        touchLastData();
        const isEcho = meshPacket.from === myNodeNumRef.current;
        let payloadText = new TextDecoder().decode(dataPacket.payload);
        const data = dataPacket as { replyId?: number; reply_id?: number; emoji?: number };

        const rawReplyId = data.replyId ?? data.reply_id ?? undefined;
        const replyId = rawReplyId != null && rawReplyId !== 0 ? rawReplyId : undefined;
        const wireEmoji = data.emoji != null && data.emoji !== 0 ? data.emoji : undefined;

        if (payloadText.trim() === '0' && !replyId && !wireEmoji) {
          // Strip leading "0" payloads that are just a placeholder from buggy senders
          payloadText = '';
        }

        const emoji = replyId
          ? (normalizeReactionEmoji(wireEmoji, payloadText) ?? wireEmoji ?? undefined)
          : undefined;

        const msg: ChatMessage = {
          sender_id: meshPacket.from,
          sender_name: getNodeName(meshPacket.from),
          payload: payloadText,
          channel: meshPacket.channel ?? 0,
          timestamp: meshPacket.rxTime ? meshPacket.rxTime * 1000 : Date.now(),
          packetId: meshPacket.id,
          status: isEcho ? 'sending' : undefined,
          emoji,
          replyId,
          to: meshPacket.to && meshPacket.to !== BROADCAST_ADDR ? meshPacket.to : undefined,
        };

        // Packet ID dedup: skip if already seen (e.g. via MQTT) so same message is not shown twice
        if (!isEcho && !msg.emoji && msg.packetId && isDuplicate(msg.packetId)) {
          // Upgrade receivedVia to 'both' if this packet was already saved via MQTT
          const rfDedupPacketId = msg.packetId;
          setMessages((prev) =>
            prev.map((m) =>
              m.packetId === rfDedupPacketId && m.receivedVia === 'mqtt'
                ? { ...m, receivedVia: 'both' as const }
                : m,
            ),
          );
          void window.electronAPI.db.updateMessageReceivedVia(rfDedupPacketId);
          return;
        }

        // If we have an optimistic message in state for this send, skip the echo to avoid a duplicate
        if (isEcho && pendingTempIdRef.current !== undefined) {
          pendingTempIdRef.current = undefined;
          return;
        }

        const rfMsg: ChatMessage = isEcho
          ? msg
          : {
              ...msg,
              receivedVia: 'rf' as const,
              isHistory: isConfiguringRef.current || undefined,
            };
        setMessages((prev) => {
          // Dedup reaction retransmissions before the DB write completes
          if (rfMsg.emoji && rfMsg.replyId) {
            const isDup = prev.some(
              (m) =>
                m.emoji === rfMsg.emoji &&
                m.replyId === rfMsg.replyId &&
                m.sender_id === rfMsg.sender_id,
            );
            if (isDup) return prev;
          }
          // Dedup regular messages by packetId (e.g. device config-sync replay)
          if (!rfMsg.emoji && rfMsg.packetId && prev.some((m) => m.packetId === rfMsg.packetId)) {
            return prev;
          }
          return [...prev, rfMsg];
        });
        void window.electronAPI.db.saveMessage(rfMsg);

        // Gateway uplink: forward RF messages to MQTT if uplinkEnabled for this channel
        // Skip our own echoes, reactions, and DMs (privacy)
        if (!isEcho && !emoji && !msg.to && mqttStatusRef.current === 'connected') {
          const chCfg = channelConfigsRef.current.find((c) => c.index === msg.channel);
          if (chCfg?.uplinkEnabled) {
            window.electronAPI.mqtt
              .publish({
                text: msg.payload,
                from: msg.sender_id,
                channel: msg.channel,
                destination: BROADCAST_ADDR,
                channelName: 'LongFast',
              })
              .then(isDuplicate)
              .catch((e: unknown) => {
                console.debug('[useDevice] MQTT publish echo register non-fatal', e);
              });
          }
        }

        // Desktop notification for incoming messages when app is not focused
        if (!isEcho && !emoji && document.hidden) {
          try {
            const title = msg.to ? `DM from ${msg.sender_name}` : `Message from ${msg.sender_name}`;
            new Notification(title, {
              body: msg.payload.slice(0, 100),
              silent: false,
            });
          } catch (e) {
            console.debug('[useDevice] Notification not available', e);
          }
        }
      });
      unsubscribesRef.current.push(unsub3);

      // ─── User info (node identity) ─────────────────────────────
      const unsub4 = device.events.onUserPacket.subscribe((packet) => {
        touchLastData();
        rfHeardNodeIds.current.add(packet.from);
        const user = packet.data as {
          id?: string;
          longName?: string;
          shortName?: string;
          hwModel?: number;
          role?: number;
        };
        updateNodes((prev) => {
          const updated = new Map(prev);
          const existing = updated.get(packet.from) ?? emptyNode(packet.from);
          const long_name = preferNonEmptyTrimmedString(user.longName, existing.long_name, {
            nodeId: packet.from,
          });
          const short_name = meshtasticShortNameAfterClearingDefault(
            long_name,
            preferNonEmptyTrimmedString(user.shortName, existing.short_name),
            packet.from,
          );
          const node: MeshNode = {
            ...existing,
            node_id: packet.from,
            long_name,
            short_name,
            hw_model: String(user.hwModel ?? existing.hw_model),
            role: user.role ?? existing.role,
            // User packets are often replayed from the device DB at connect; do not
            // bump last_hear to now or offline nodes appear freshly heard.
            last_heard: existing.last_heard,
            heard_via_mqtt_only: false,
            source: 'rf',
          };
          updated.set(packet.from, node);
          void window.electronAPI.db.saveNode(node);
          return updated;
        });
        if (packet.from === myNodeNumRef.current) {
          setDeviceOwner({
            longName: preferNonEmptyTrimmedString(user.longName, ''),
            shortName: preferNonEmptyTrimmedString(user.shortName, ''),
            isLicensed: (user as { isLicensed?: boolean }).isLicensed ?? false,
          });
        }
      });
      unsubscribesRef.current.push(unsub4);

      // ─── Node info packets ─────────────────────────────────────
      const unsub5 = device.events.onNodeInfoPacket.subscribe((packet) => {
        touchLastData();
        const rfNodeId = (packet as any).num ?? (packet as any).from;
        if (rfNodeId != null) rfHeardNodeIds.current.add(rfNodeId);
        const info = packet as {
          num?: number;
          user?: {
            longName?: string;
            shortName?: string;
            hwModel?: number;
            role?: number;
          };
          snr?: number;
          position?: { latitudeI?: number; longitudeI?: number; altitude?: number };
          deviceMetrics?: {
            batteryLevel?: number;
            voltage?: number;
            channelUtilization?: number;
            airUtilTx?: number;
          };
          lastHeard?: number;
          hopsAway?: number;
          viaMqtt?: boolean;
        };
        if (!info.num) return;
        const nodeNum = info.num;
        const prevOwnRole =
          nodeNum === myNodeNumRef.current ? nodesRef.current.get(nodeNum)?.role : undefined;

        updateNodes((prev) => {
          const updated = new Map(prev);
          const existing = updated.get(nodeNum) ?? emptyNode(nodeNum);

          let newLat = existing.latitude;
          let newLon = existing.longitude;
          let newAlt = info.position?.altitude ?? existing.altitude;
          let posWarn: string | undefined = existing.lastPositionWarning;

          if (info.position?.latitudeI != null && info.position?.longitudeI != null) {
            const lat = info.position.latitudeI / 1e7;
            const lon = info.position.longitudeI / 1e7;
            const r = validateCoords(lat, lon);
            if (r.valid) {
              newLat = lat;
              newLon = lon;
              newAlt = info.position?.altitude ?? existing.altitude;
              posWarn = undefined;
            } else if (
              nodeNum !== myNodeNumRef.current ||
              (existing.latitude === 0 && existing.longitude === 0)
            ) {
              posWarn = r.warning;
            }
          }

          const lastHeardMs = computeNodeInfoLastHeardMs(
            info.lastHeard,
            existing.last_heard,
            nodeNum === myNodeNumRef.current,
          );
          const lastHeardStale =
            lastHeardMs > 0 &&
            Date.now() - lastHeardMs > MESHTASTIC_CAPABILITIES.nodeStaleThresholdMs;

          const long_name = preferNonEmptyTrimmedString(info.user?.longName, existing.long_name, {
            nodeId: nodeNum,
          });
          const short_name = meshtasticShortNameAfterClearingDefault(
            long_name,
            preferNonEmptyTrimmedString(info.user?.shortName, existing.short_name),
            nodeNum,
          );
          const node: MeshNode = {
            ...existing,
            node_id: nodeNum,
            long_name,
            short_name,
            hw_model: String(info.user?.hwModel ?? existing.hw_model),
            snr: info.snr ?? existing.snr,
            battery: info.deviceMetrics?.batteryLevel ?? existing.battery,
            last_heard: lastHeardMs,
            latitude: newLat,
            longitude: newLon,
            role: info.user?.role ?? existing.role,
            // Stale NodeInfo still carries cached hops; don't show hop count for ghosts.
            hops_away:
              nodeNum === myNodeNumRef.current
                ? (info.hopsAway ?? 0)
                : lastHeardStale
                  ? undefined
                  : (info.hopsAway ?? existing.hops_away),
            via_mqtt: info.viaMqtt ?? existing.via_mqtt,
            voltage: info.deviceMetrics?.voltage ?? existing.voltage,
            channel_utilization:
              info.deviceMetrics?.channelUtilization ?? existing.channel_utilization,
            air_util_tx: info.deviceMetrics?.airUtilTx ?? existing.air_util_tx,
            altitude: newAlt,
            heard_via_mqtt_only: false,
            source: 'rf',
            lastPositionWarning: posWarn,
          };
          updated.set(nodeNum, node);
          void window.electronAPI.db.saveNode(node);
          return updated;
        });
        if (nodeNum === myNodeNumRef.current && info.deviceMetrics?.batteryLevel !== undefined) {
          applyOwnNodeBatteryFromDeviceMetrics(info.deviceMetrics.batteryLevel);
        }
        if (
          nodeNum === myNodeNumRef.current &&
          nodesRef.current.get(nodeNum)?.role === ROLE_CLIENT_MUTE &&
          prevOwnRole !== ROLE_CLIENT_MUTE
        ) {
          console.info(
            '[useDevice] Device role is Client Mute — position reports to device suppressed',
          );
        }
        const updatedRfNode = nodesRef.current.get(nodeNum);
        if (updatedRfNode && getStoredMeshProtocol() === 'meshtastic') {
          useDiagnosticsStore
            .getState()
            .processNodeUpdate(
              updatedRfNode,
              nodesRef.current.get(myNodeNumRef.current) ?? null,
              myNodeNumRef.current,
              MESHTASTIC_CAPABILITIES,
            );
        }
        if (info.position?.latitudeI != null && info.position?.longitudeI != null) {
          const lat = info.position.latitudeI / 1e7;
          const lon = info.position.longitudeI / 1e7;
          if (validateCoords(lat, lon).valid) {
            usePositionHistoryStore.getState().recordPosition(nodeNum, lat, lon);
          }
        }
        if (type === 'ble' && nodeNum === myNodeNumRef.current) {
          const btDevice = (device.transport as any)?.__bluetoothDevice;
          const shortName = preferNonEmptyTrimmedString(info.user?.shortName, '') || null;
          if (btDevice?.id && shortName) {
            try {
              const key = 'mesh-client:bleDeviceNames';
              const cache =
                parseStoredJson<Record<string, string>>(
                  localStorage.getItem(key),
                  'useDevice bleDeviceNames cache',
                ) ?? {};
              cache[btDevice.id] = shortName;
              localStorage.setItem(key, JSON.stringify(cache));
            } catch {
              // catch-no-log-ok localStorage write for BLE device name cache — non-critical
            }
          }
        }
        if (type === 'serial' && nodeNum === myNodeNumRef.current) {
          const portId = localStorage.getItem(LAST_SERIAL_PORT_KEY);
          const shortName =
            preferNonEmptyTrimmedString(
              info.user?.shortName,
              preferNonEmptyTrimmedString(info.user?.longName, ''),
            ) || null;
          if (portId && shortName) {
            try {
              const key = 'mesh-client:serialPortNodeNames';
              const cache =
                parseStoredJson<Record<string, string>>(
                  localStorage.getItem(key),
                  'useDevice serialPortNodeNames cache',
                ) ?? {};
              cache[portId] = shortName;
              localStorage.setItem(key, JSON.stringify(cache));
            } catch {
              // catch-no-log-ok localStorage write for serial port node name cache — non-critical
            }
          }
        }
      });
      unsubscribesRef.current.push(unsub5);

      // ─── Position packets ──────────────────────────────────────
      const unsub6 = device.events.onPositionPacket.subscribe((packet) => {
        touchLastData();
        if (packet.from !== 0) {
          rfHeardNodeIds.current.add(packet.from);
        }
        const pos = packet.data as {
          latitudeI?: number;
          longitudeI?: number;
          altitude?: number;
        };

        const lat = (pos.latitudeI ?? 0) / 1e7;
        const lon = (pos.longitudeI ?? 0) / 1e7;
        const r = validateCoords(lat, lon);

        if (!r.valid) {
          updateNodes((prev) => {
            const updated = new Map(prev);
            const existing = updated.get(packet.from) ?? emptyNode(packet.from);
            // Don't flag our own node if we have valid fallback coords
            if (
              packet.from === myNodeNumRef.current &&
              (existing.latitude != null || existing.longitude != null)
            ) {
              return prev; // no change
            }
            updated.set(packet.from, { ...existing, lastPositionWarning: r.warning });
            return updated;
          });
          return;
        }

        updateNodes((prev) => {
          const updated = new Map(prev);
          const existing = updated.get(packet.from) ?? emptyNode(packet.from);

          const node: MeshNode = {
            ...existing,
            latitude: lat,
            longitude: lon,
            altitude: pos.altitude ?? existing.altitude,
            // Position replays at connect must not bump last_heard to now.
            last_heard: existing.last_heard,
            lastPositionWarning: undefined,
          };
          updated.set(packet.from, node);
          void window.electronAPI.db.saveNode(node);
          return updated;
        });
        usePositionHistoryStore.getState().recordPosition(packet.from, lat, lon);
      });
      unsubscribesRef.current.push(unsub6);

      // ─── Telemetry ─────────────────────────────────────────────
      const unsub7 = device.events.onTelemetryPacket.subscribe((packet) => {
        touchLastData();
        const tel = packet.data as {
          deviceMetrics?: { batteryLevel?: number; voltage?: number };
          variant?: {
            case?: string;
            value?: {
              batteryLevel?: number;
              voltage?: number;
              channelUtilization?: number;
              airUtilTx?: number;
              numPacketsRxBad?: number;
              numRxDupe?: number;
              numPacketsRx?: number;
              numPacketsTx?: number;
              // environmentMetrics fields
              temperature?: number;
              relativeHumidity?: number;
              barometricPressure?: number;
              gasResistance?: number;
              iaq?: number;
              lux?: number;
              windSpeed?: number;
              windDirection?: number;
              windGust?: number;
              windLull?: number;
              weight?: number;
              rainfall1h?: number;
              rainfall24h?: number;
            };
          };
        };

        // Handle environmentMetrics variant
        if (tel.variant?.case === 'environmentMetrics' && tel.variant.value) {
          const env = tel.variant.value;
          const point: EnvironmentTelemetryPoint = {
            timestamp: Date.now(),
            nodeNum: packet.from,
            temperature: env.temperature,
            relativeHumidity: env.relativeHumidity,
            barometricPressure: env.barometricPressure,
            gasResistance: env.gasResistance,
            iaq: env.iaq,
            lux: env.lux,
            windSpeed: env.windSpeed,
            windDirection: env.windDirection,
            windGust: env.windGust,
            windLull: env.windLull,
            weight: env.weight,
            rainfall1h: env.rainfall1h,
            rainfall24h: env.rainfall24h,
          };
          setEnvironmentTelemetry((prev) => [...prev, point].slice(-MAX_TELEMETRY_POINTS));
          updateNodes((prev) => {
            const updated = new Map(prev);
            const existing = updated.get(packet.from);
            if (existing) {
              updated.set(packet.from, {
                ...existing,
                env_temperature: env.temperature ?? existing.env_temperature,
                env_humidity: env.relativeHumidity ?? existing.env_humidity,
                env_pressure: env.barometricPressure ?? existing.env_pressure,
                env_iaq: env.iaq ?? existing.env_iaq,
                env_lux: env.lux ?? existing.env_lux,
                env_wind_speed: env.windSpeed ?? existing.env_wind_speed,
                env_wind_direction: env.windDirection ?? existing.env_wind_direction,
              });
            }
            return updated;
          });
          return;
        }

        // Handle localStats variant (connected node's radio statistics)
        if (
          tel.variant?.case === 'localStats' &&
          tel.variant.value &&
          packet.from === myNodeNumRef.current
        ) {
          const ls = tel.variant.value;
          updateNodes((prev) => {
            const updated = new Map(prev);
            const existing = updated.get(myNodeNumRef.current);
            if (existing) {
              const node: MeshNode = {
                ...existing,
                channel_utilization: ls.channelUtilization ?? existing.channel_utilization,
                air_util_tx: ls.airUtilTx ?? existing.air_util_tx,
                num_packets_rx_bad: ls.numPacketsRxBad ?? existing.num_packets_rx_bad,
                num_rx_dupe: ls.numRxDupe ?? existing.num_rx_dupe,
                num_packets_rx: ls.numPacketsRx ?? existing.num_packets_rx,
                num_packets_tx: ls.numPacketsTx ?? existing.num_packets_tx,
              };
              updated.set(myNodeNumRef.current, node);
              void window.electronAPI.db.saveNode(node);
            }
            return updated;
          });
          return;
        }

        const metrics = tel.deviceMetrics ?? tel.variant?.value;
        if (!metrics) return;

        const point: TelemetryPoint = {
          timestamp: Date.now(),
          batteryLevel: metrics.batteryLevel,
          voltage: metrics.voltage,
        };
        setTelemetry((prev) => [...prev, point].slice(-MAX_TELEMETRY_POINTS));

        // Update node battery if from a known node
        if (metrics.batteryLevel != null && packet.from) {
          updateNodes((prev) => {
            const updated = new Map(prev);
            const existing = updated.get(packet.from);
            if (existing) {
              updated.set(packet.from, {
                ...existing,
                battery: metrics.batteryLevel!,
                // Telemetry replay at connect must not bump last_heard to now.
              });
            }
            return updated;
          });
          if (packet.from === myNodeNumRef.current) {
            applyOwnNodeBatteryFromDeviceMetrics(metrics.batteryLevel);
          }
        }
      });
      unsubscribesRef.current.push(unsub7);

      // ─── Channel discovery ─────────────────────────────────────
      const unsub8 = device.events.onChannelPacket.subscribe((channel) => {
        touchLastData();
        const ch = channel as {
          index?: number;
          settings?: {
            name?: string;
            psk?: Uint8Array;
            uplinkEnabled?: boolean;
            downlinkEnabled?: boolean;
            moduleSettings?: { positionPrecision?: number };
          };
          role?: number;
        };
        if (ch.index === undefined) return;

        // Update simple channels list for chat pill selector (skip disabled)
        if (ch.role !== 0) {
          setChannels((prev) => {
            const existing = prev.findIndex((c) => c.index === ch.index);
            const entry = {
              index: ch.index!,
              name: ch.settings?.name || (ch.index === 0 ? 'Primary' : `Channel ${ch.index}`),
            };
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = entry;
              return updated;
            }
            return [...prev, entry].sort((a, b) => a.index - b.index);
          });
        }

        // Update full channel configs for config panel (includes disabled)
        setChannelConfigs((prev) => {
          const existing = prev.findIndex((c) => c.index === ch.index);
          const entry = {
            index: ch.index!,
            name: ch.settings?.name || '',
            role: ch.role ?? 0,
            psk: ch.settings?.psk ?? new Uint8Array([1]),
            uplinkEnabled: ch.settings?.uplinkEnabled ?? false,
            downlinkEnabled: ch.settings?.downlinkEnabled ?? false,
            positionPrecision: ch.settings?.moduleSettings?.positionPrecision ?? 0,
          };
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = entry;
            return updated;
          }
          return [...prev, entry].sort((a, b) => a.index - b.index);
        });
      });
      unsubscribesRef.current.push(unsub8);

      // ─── SNR/RSSI from mesh packets ────────────────────────────
      const unsub9 = device.events.onMeshPacket.subscribe((packet) => {
        touchLastData();
        const mp = packet as {
          id?: number;
          rxSnr?: number;
          rxRssi?: number;
          from?: number;
          hopLimit?: number;
          hopStart?: number;
          viaMqtt?: boolean;
        };
        if (!mp.from) return;

        const hopStart = mp.hopStart ?? 0;
        const hopLimit = mp.hopLimit ?? 0;
        const packetViaMqtt = mp.viaMqtt === true;
        const computedHopsAway =
          !packetViaMqtt && hopStart > 0 && hopLimit <= hopStart ? hopStart - hopLimit : undefined;

        // Record RF path for packet redundancy tracking (skip id 0 — protobuf: no unique id for no-ack/non-broadcast)
        const rawId = Number(mp.id);
        const packetId = rawId >>> 0;
        if (getStoredMeshProtocol() === 'meshtastic' && Number.isInteger(rawId) && packetId !== 0) {
          useDiagnosticsStore.getState().recordPacketPath(packetId, mp.from, {
            transport: 'rf',
            snr: mp.rxSnr,
            rssi: mp.rxRssi,
            timestamp: Date.now(),
          });
        }

        const hasSignal = Boolean(mp.rxSnr || mp.rxRssi);
        const hasHopUpdate = computedHopsAway !== undefined && mp.from !== myNodeNumRef.current;

        if (hasSignal || hasHopUpdate) {
          updateNodes((prev) => {
            const updated = new Map(prev);
            const existing = updated.get(mp.from!);
            if (existing) {
              const node: MeshNode = {
                ...existing,
                ...(mp.rxSnr ? { snr: mp.rxSnr } : {}),
                ...(mp.rxRssi ? { rssi: mp.rxRssi } : {}),
                ...(hasHopUpdate &&
                !(
                  existing.last_heard > 0 &&
                  Date.now() - existing.last_heard > MESHTASTIC_CAPABILITIES.nodeStaleThresholdMs
                )
                  ? { hops_away: computedHopsAway }
                  : {}),
              };
              updated.set(mp.from!, node);
              void window.electronAPI.db.saveNode(node);
            }
            return updated;
          });
        }

        if (mp.rxSnr || mp.rxRssi) {
          setSignalTelemetry((prev) =>
            [
              ...prev,
              {
                timestamp: Date.now(),
                snr: mp.rxSnr,
                rssi: mp.rxRssi,
              },
            ].slice(-MAX_TELEMETRY_POINTS),
          );
        }
      });
      unsubscribesRef.current.push(unsub9);

      // ─── Mesh heartbeat (built-in liveness signal) ─────────────
      const unsub10 = device.events.onMeshHeartbeat.subscribe(() => {
        touchLastData();
      });
      unsubscribesRef.current.push(unsub10);

      // ─── Device config (track GPS mode and telemetry) ───────────
      const unsubConfig = device.events.onConfigPacket.subscribe((config) => {
        const cfg = config as {
          payloadVariant?: {
            case?: string;
            value?: {
              gpsMode?: number;
              device_update_interval?: number;
              deviceUpdateInterval?: number;
            };
          };
        };
        if (cfg.payloadVariant?.case === 'position' && cfg.payloadVariant.value?.gpsMode != null) {
          deviceGpsModeRef.current = cfg.payloadVariant.value.gpsMode;
          setDeviceGpsMode(cfg.payloadVariant.value.gpsMode);
        }
        if (cfg.payloadVariant?.case === 'telemetry' && cfg.payloadVariant.value != null) {
          const interval =
            cfg.payloadVariant.value.device_update_interval ??
            cfg.payloadVariant.value.deviceUpdateInterval;
          if (typeof interval === 'number') {
            setTelemetryDeviceUpdateInterval(interval);
          }
        }
        if (cfg.payloadVariant?.case === 'security' && cfg.payloadVariant.value != null) {
          setSecurityConfig(
            cfg.payloadVariant.value as {
              publicKey: Uint8Array;
              privateKey: Uint8Array;
              adminKey: Uint8Array[];
              isManaged: boolean;
              serialEnabled: boolean;
              debugLogApiEnabled: boolean;
              adminChannelEnabled: boolean;
            },
          );
        }
      });
      unsubscribesRef.current.push(unsubConfig);

      // ─── Trace route responses ──────────────────────────────────
      const unsubTrace = device.events.onTraceRoutePacket.subscribe((packet) => {
        setTraceRouteResults((prev) => {
          const updated = new Map(prev);
          updated.set(packet.from, {
            route: (packet.data as { route: number[] }).route ?? [],
            from: packet.from,
            timestamp: Date.now(),
          });
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubTrace);

      // ─── Queue status ──────────────────────────────────────────
      const unsubQueue = device.events.onQueueStatus.subscribe((qs) => {
        setQueueStatus({ free: qs.free, maxlen: qs.maxlen, res: qs.res });
      });
      unsubscribesRef.current.push(unsubQueue);

      // ─── Device log records ────────────────────────────────────
      const MAX_DEVICE_LOGS = 500;
      const unsubLog = device.events.onLogRecord.subscribe((record) => {
        setDeviceLogs((prev) => {
          const next = prev.length >= MAX_DEVICE_LOGS ? prev.slice(-MAX_DEVICE_LOGS + 1) : prev;
          return [
            ...next,
            {
              message: record.message,
              time: Date.now(),
              source: record.source,
              level: record.level,
            },
          ];
        });
        if (
          getStoredMeshProtocol() === 'meshtastic' &&
          containsMeshCorePattern(record.message) &&
          myNodeNumRef.current !== 0
        ) {
          const { rssi, snr } = extractRssiSnr(record.message);
          useDiagnosticsStore
            .getState()
            .recordForeignLora(myNodeNumRef.current, 'meshcore', rssi, snr);
        }
      });
      unsubscribesRef.current.push(unsubLog);

      // ─── Neighbor info ─────────────────────────────────────────
      const unsubNeighbor = device.events.onNeighborInfoPacket.subscribe((packet) => {
        touchLastData();
        const data = packet.data as {
          nodeId?: number;
          neighbors?: { nodeId?: number; snr?: number; lastRxTime?: number }[];
        };
        if (!data.nodeId) return;
        const record: NeighborInfoRecord = {
          nodeId: data.nodeId,
          neighbors: (data.neighbors ?? []).map((n) => ({
            nodeId: n.nodeId ?? 0,
            snr: n.snr ?? 0,
            lastRxTime: n.lastRxTime ?? 0,
          })),
          timestamp: Date.now(),
        };
        setNeighborInfo((prev) => {
          const updated = new Map(prev);
          updated.set(record.nodeId, record);
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubNeighbor);

      // ─── Waypoints ─────────────────────────────────────────────
      const unsubWaypoint = device.events.onWaypointPacket.subscribe((packet) => {
        touchLastData();
        const data = packet.data as {
          id?: number;
          latitudeI?: number;
          longitudeI?: number;
          name?: string;
          description?: string;
          icon?: number;
          lockedTo?: number;
          expire?: number;
        };
        if (!data.id) return;
        const waypoint: MeshWaypoint = {
          id: data.id,
          latitude: (data.latitudeI ?? 0) / 1e7,
          longitude: (data.longitudeI ?? 0) / 1e7,
          name: data.name ?? '',
          description: data.description,
          icon: data.icon,
          lockedTo: data.lockedTo,
          expire: data.expire,
          from: packet.from,
          timestamp: Date.now(),
        };
        // expire=1 means deletion
        setWaypoints((prev) => {
          const updated = new Map(prev);
          if (data.expire === 1) {
            updated.delete(data.id!);
          } else {
            updated.set(waypoint.id, waypoint);
          }
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubWaypoint);

      // ─── Module config packets ─────────────────────────────────
      const unsubModuleConfig = device.events.onModuleConfigPacket.subscribe((config) => {
        const cfg = config as { payloadVariant?: { case?: string; value?: unknown } };
        if (cfg.payloadVariant?.case) {
          setModuleConfigs((prev) => ({
            ...prev,
            [cfg.payloadVariant!.case!]: cfg.payloadVariant!.value,
          }));
        }
      });
      unsubscribesRef.current.push(unsubModuleConfig);

      // ─── Remote Hardware packets ──────────────────────────────────
      const unsubRemoteHardware = device.events.onRemoteHardwarePacket.subscribe((packet) => {
        touchLastData();
        const data = packet.data as { raw?: Uint8Array };
        setRemoteHardwareMessages((prev) => {
          const updated = new Map(prev);
          const from = packet.from;
          const existing = updated.get(from) ?? [];
          updated.set(from, [
            ...existing.slice(-10),
            { from, data: data.raw ?? new Uint8Array(), timestamp: Date.now() },
          ]);
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubRemoteHardware);

      // ─── Audio packets ─────────────────────────────────────────────
      const unsubAudio = device.events.onAudioPacket.subscribe((packet) => {
        touchLastData();
        setAudioMessages((prev) => {
          const updated = new Map(prev);
          const from = packet.from;
          const existing = updated.get(from) ?? [];
          updated.set(from, [
            ...existing.slice(-50),
            { from, data: packet.data, timestamp: Date.now() },
          ]);
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubAudio);

      // ─── Detection Sensor packets ─────────────────────────────────
      const unsubDetectionSensor = device.events.onDetectionSensorPacket.subscribe((packet) => {
        touchLastData();
        setDetectionSensorEvents((prev) => {
          const updated = new Map(prev);
          const from = packet.from;
          const existing = updated.get(from) ?? [];
          updated.set(from, [
            ...existing.slice(-100),
            { from, data: packet.data, timestamp: Date.now() },
          ]);
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubDetectionSensor);

      // ─── Ping/Reply packets ───────────────────────────────────────
      const unsubPing = device.events.onPingPacket.subscribe((packet) => {
        touchLastData();
        setPingResponses((prev) => {
          const updated = new Map(prev);
          updated.set(packet.from, {
            from: packet.from,
            data: packet.data,
            timestamp: Date.now(),
          });
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubPing);

      // ─── IP Tunnel packets ─────────────────────────────────────────
      const unsubIpTunnel = device.events.onIpTunnelPacket.subscribe((packet) => {
        touchLastData();
        setIpTunnelMessages((prev) => {
          const updated = new Map(prev);
          const from = packet.from;
          const existing = updated.get(from) ?? [];
          updated.set(from, [
            ...existing.slice(-100),
            { from, data: packet.data, timestamp: Date.now() },
          ]);
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubIpTunnel);

      // ─── PaxCounter packets ───────────────────────────────────────
      const unsubPaxcounter = device.events.onPaxcounterPacket.subscribe((packet) => {
        touchLastData();
        const pax = packet.data as { count?: number };
        setPaxCounterData((prev) => {
          const updated = new Map(prev);
          updated.set(packet.from, {
            from: packet.from,
            count: pax.count ?? 0,
            timestamp: Date.now(),
          });
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubPaxcounter);

      // ─── Serial packets ───────────────────────────────────────────
      const unsubSerial = device.events.onSerialPacket.subscribe((packet) => {
        touchLastData();
        setSerialMessages((prev) => {
          const updated = new Map(prev);
          const from = packet.from;
          const existing = updated.get(from) ?? [];
          updated.set(from, [
            ...existing.slice(-100),
            { from, data: packet.data, timestamp: Date.now() },
          ]);
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubSerial);

      // ─── Store & Forward packets ───────────────────────────────────
      const unsubStoreForward = device.events.onStoreForwardPacket.subscribe((packet) => {
        touchLastData();
        setStoreForwardMessages((prev) => {
          const updated = new Map(prev);
          const from = packet.from;
          const existing = updated.get(from) ?? [];
          updated.set(from, [
            ...existing.slice(-50),
            { from, data: packet.data, timestamp: Date.now() },
          ]);
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubStoreForward);

      // ─── Range Test packets ────────────────────────────────────────
      const unsubRangeTest = device.events.onRangeTestPacket.subscribe((packet) => {
        touchLastData();
        setRangeTestPackets((prev) => {
          const updated = new Map(prev);
          const from = packet.from;
          const existing = updated.get(from) ?? [];
          updated.set(from, [
            ...existing.slice(-100),
            { from, data: packet.data, timestamp: Date.now() },
          ]);
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubRangeTest);

      // ─── ZPS packets ───────────────────────────────────────────────
      const unsubZps = device.events.onZpsPacket.subscribe((packet) => {
        touchLastData();
        setZpsMessages((prev) => {
          const updated = new Map(prev);
          const from = packet.from;
          const existing = updated.get(from) ?? [];
          updated.set(from, [
            ...existing.slice(-50),
            { from, data: packet.data, timestamp: Date.now() },
          ]);
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubZps);

      // ─── Simulator packets ────────────────────────────────────────
      const unsubSimulator = device.events.onSimulatorPacket.subscribe((packet) => {
        touchLastData();
        setSimulatorPackets((prev) => {
          const updated = new Map(prev);
          const from = packet.from;
          const existing = updated.get(from) ?? [];
          updated.set(from, [
            ...existing.slice(-50),
            { from, data: packet.data, timestamp: Date.now() },
          ]);
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubSimulator);

      // ─── ATAK Plugin packets ───────────────────────────────────────
      const unsubAtakPlugin = device.events.onAtakPluginPacket.subscribe((packet) => {
        touchLastData();
        setAtakMessages((prev) => {
          const updated = new Map(prev);
          const from = packet.from;
          const existing = updated.get(from) ?? [];
          updated.set(from, [
            ...existing.slice(-100),
            { from, data: packet.data, timestamp: Date.now() },
          ]);
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubAtakPlugin);

      // ─── Map Report packets ────────────────────────────────────────
      const unsubMapReport = device.events.onMapReportPacket.subscribe((packet) => {
        touchLastData();
        setMapReports((prev) => {
          const updated = new Map(prev);
          updated.set(packet.from, {
            from: packet.from,
            data: packet.data,
            timestamp: Date.now(),
          });
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubMapReport);

      // ─── Private App packets ───────────────────────────────────────
      const unsubPrivate = device.events.onPrivatePacket.subscribe((packet) => {
        touchLastData();
        setPrivateMessages((prev) => {
          const updated = new Map(prev);
          const from = packet.from;
          const existing = updated.get(from) ?? [];
          updated.set(from, [
            ...existing.slice(-50),
            { from, data: packet.data, timestamp: Date.now() },
          ]);
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubPrivate);

      // ─── ATAK Forwarder packets ────────────────────────────────────
      const unsubAtakForwarder = device.events.onAtakForwarderPacket.subscribe((packet) => {
        touchLastData();
        setAtakMessages((prev) => {
          const updated = new Map(prev);
          const from = packet.from;
          const existing = updated.get(from) ?? [];
          updated.set(from, [
            ...existing.slice(-100),
            { from, data: packet.data, timestamp: Date.now() },
          ]);
          return updated;
        });
      });
      unsubscribesRef.current.push(unsubAtakForwarder);

      // ─── Noble BLE disconnect detection ────────────────────────
      if (type === 'ble') {
        const unsubNobleDisconnect = window.electronAPI.onNobleBleDisconnected((sessionId) => {
          if (sessionId !== 'meshtastic') return;
          console.warn('[useDevice] Noble BLE disconnected event received');
          handleConnectionLostRef.current();
        });
        unsubscribesRef.current.push(unsubNobleDisconnect);
      }

      // ─── Serial heartbeat (existing behavior, keeps device alive)
      if (type === 'serial') {
        try {
          device.setHeartbeatInterval(60_000);
        } catch (e) {
          console.warn('[useDevice] serial: setHeartbeatInterval failed', e);
        }
      }
    },
    [
      touchLastData,
      applyOwnNodeBatteryFromDeviceMetrics,
      getNodeName,
      updateNodes,
      startPolling,
      stopPolling,
      startWatchdog,
      stopWatchdog,
      cleanupSubscriptions,
      startGpsInterval,
      stopGpsInterval,
      isDuplicate,
      ensureNodeExists,
      clearConfigureTimeout,
    ],
  );

  // ─── Connection lost handler ──────────────────────────────────
  const handleConnectionLost = useCallback(() => {
    if (isReconnectingRef.current) return;
    console.warn('[useDevice] Connection lost — initiating reconnect');
    isReconnectingRef.current = true;

    // Clean up existing connection
    clearConfigureTimeout();
    cleanupSubscriptions();
    stopPolling();
    stopWatchdog();
    stopGpsInterval();
    const oldDevice = deviceRef.current;
    deviceRef.current = null;
    if (oldDevice)
      safeDisconnect(oldDevice).catch((e: unknown) => {
        console.debug('[useDevice] handleConnectionLost safeDisconnect', e);
      });

    // Begin reconnection
    void attemptReconnectRef.current();
  }, [clearConfigureTimeout, cleanupSubscriptions, stopPolling, stopWatchdog, stopGpsInterval]);

  // Keep the ref in sync
  handleConnectionLostRef.current = handleConnectionLost;

  // ─── Reconnection with exponential backoff ────────────────────
  const attemptReconnect = useCallback(async () => {
    const params = connectionParamsRef.current;
    if (!params) {
      isReconnectingRef.current = false;
      setState((s) => ({
        ...s,
        status: 'disconnected',
        connectionType: null,
        batteryPercent: undefined,
        batteryCharging: undefined,
      }));
      return;
    }

    if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      isReconnectingRef.current = false;
      reconnectAttemptRef.current = 0;
      setState((s) => ({
        ...s,
        status: 'disconnected',
        connectionType: null,
        batteryPercent: undefined,
        batteryCharging: undefined,
      }));
      return;
    }

    // Capture the current generation so stale attempts can be detected
    const generation = reconnectGenerationRef.current;

    reconnectAttemptRef.current++;
    setState((s) => ({
      ...s,
      status: 'reconnecting',
      reconnectAttempt: reconnectAttemptRef.current,
    }));

    const delay = Math.min(2000 * Math.pow(2, reconnectAttemptRef.current - 1), 32000);
    console.debug(
      `[useDevice] reconnect: waiting ${delay}ms before attempt ${reconnectAttemptRef.current}/${MAX_RECONNECT_ATTEMPTS}`,
    );
    await new Promise((r) => setTimeout(r, delay));

    // Check if user manually disconnected or started a new connection during the wait
    if (!isReconnectingRef.current || reconnectGenerationRef.current !== generation) return;

    try {
      let device: MeshDevice;
      if (params.type === 'ble') {
        if (!params.blePeripheralId) throw new Error('BLE peripheral ID not stored for reconnect');
        device = await createBleConnection(params.blePeripheralId, 'meshtastic');
      } else {
        device = await createConnection(params.type, params.httpAddress);
      }
      deviceRef.current = device;
      wireSubscriptions(device, params.type);
      void device.configure();

      // Success
      console.debug(`[useDevice] Reconnect succeeded on attempt ${reconnectAttemptRef.current}`);
      reconnectAttemptRef.current = 0;
      isReconnectingRef.current = false;
    } catch (err) {
      console.warn(`[Meshtastic] Reconnect attempt ${reconnectAttemptRef.current} failed:`, err);
      // Retry
      void attemptReconnectRef.current();
    }
  }, [wireSubscriptions]);

  // Keep the ref in sync
  attemptReconnectRef.current = attemptReconnect;

  // ─── Connect ──────────────────────────────────────────────────
  const connect = useCallback(
    async (type: ConnectionType, httpAddress?: string, blePeripheralId?: string) => {
      // Force-disconnect stale device before creating a new connection
      clearConfigureTimeout();
      if (deviceRef.current) {
        cleanupSubscriptions();
        stopPolling();
        stopWatchdog();
        const oldDevice = deviceRef.current;
        deviceRef.current = null;
        safeDisconnect(oldDevice).catch((e: unknown) => {
          console.debug('[useDevice] connect safeDisconnect prior', e);
        });
      }

      // Store connection params for reconnection
      connectionParamsRef.current = { type, httpAddress, blePeripheralId };
      reconnectAttemptRef.current = 0;
      isReconnectingRef.current = false;
      reconnectGenerationRef.current++;

      setState((s) => ({
        ...s,
        status: 'connecting',
        connectionType: type,
        batteryPercent: undefined,
        batteryCharging: undefined,
      }));

      try {
        console.debug('[useDevice] connect', type, httpAddress ?? blePeripheralId);
        let device: MeshDevice;
        if (type === 'ble') {
          // On Linux, peripheralId is optional - createBleConnection will call requestDevice()
          device = await createBleConnection(blePeripheralId, 'meshtastic');
        } else {
          device = await createConnection(type, httpAddress);
        }
        deviceRef.current = device;

        // Wire all event subscriptions
        wireSubscriptions(device, type);

        // Start configuration AFTER all listeners are wired
        void device.configure();
      } catch (err) {
        clearConfigureTimeout();
        console.error('[Meshtastic] Connection failed:', err);
        cleanupSubscriptions();
        stopPolling();
        stopWatchdog();
        deviceRef.current = null;
        setState({
          status: 'disconnected',
          myNodeNum: 0,
          connectionType: null,
          batteryPercent: undefined,
          batteryCharging: undefined,
        });
        throw err;
      }
    },
    [wireSubscriptions, cleanupSubscriptions, stopPolling, stopWatchdog, clearConfigureTimeout],
  );

  /**
   * Like connect(), but for auto-connect paths that don't require a user gesture.
   * @param lastSerialPortId - Stored portId from previous manual selection (serial only).
   * @param blePeripheralId - Noble peripheral ID from previous BLE selection (BLE only).
   */
  const connectAutomatic = useCallback(
    async (
      type: ConnectionType,
      httpAddress?: string,
      lastSerialPortId?: string | null,
      blePeripheralId?: string,
    ) => {
      clearConfigureTimeout();
      if (deviceRef.current) {
        cleanupSubscriptions();
        stopPolling();
        stopWatchdog();
        const oldDevice = deviceRef.current;
        deviceRef.current = null;
        safeDisconnect(oldDevice).catch((e: unknown) => {
          console.debug('[useDevice] connectAutomatic safeDisconnect prior', e);
        });
      }

      connectionParamsRef.current = { type, httpAddress, blePeripheralId };
      reconnectAttemptRef.current = 0;
      isReconnectingRef.current = false;
      reconnectGenerationRef.current++;

      setState((s) => ({
        ...s,
        status: 'connecting',
        connectionType: type,
        batteryPercent: undefined,
        batteryCharging: undefined,
      }));

      try {
        console.debug('[useDevice] connectAutomatic', type, httpAddress ?? blePeripheralId);
        let device: MeshDevice;
        if (type === 'ble') {
          // On Linux, peripheralId is optional - createBleConnection will call requestDevice()
          device = await createBleConnection(blePeripheralId, 'meshtastic');
        } else if (type === 'serial') {
          device = await reconnectSerial(lastSerialPortId);
        } else {
          device = await createConnection(type, httpAddress);
        }
        deviceRef.current = device;
        wireSubscriptions(device, type);
        void device.configure();
      } catch (err) {
        clearConfigureTimeout();
        console.error('[Meshtastic] Auto-connect failed:', err);
        cleanupSubscriptions();
        stopPolling();
        stopWatchdog();
        deviceRef.current = null;
        setState({
          status: 'disconnected',
          myNodeNum: 0,
          connectionType: null,
          batteryPercent: undefined,
          batteryCharging: undefined,
        });
        throw err;
      }
    },
    [wireSubscriptions, cleanupSubscriptions, stopPolling, stopWatchdog, clearConfigureTimeout],
  );

  const disconnect = useCallback(async () => {
    // Stop all monitoring and reconnection
    clearConfigureTimeout();
    cleanupSubscriptions();
    stopPolling();
    stopWatchdog();
    stopGpsInterval();
    isReconnectingRef.current = false;
    reconnectAttemptRef.current = 0;
    reconnectGenerationRef.current++;
    connectionParamsRef.current = null;

    const device = deviceRef.current;
    deviceRef.current = null;
    if (device) {
      await safeDisconnect(device);
    }
    setState({
      status: 'disconnected',
      myNodeNum: 0,
      connectionType: null,
      batteryPercent: undefined,
      batteryCharging: undefined,
    });
  }, [cleanupSubscriptions, stopPolling, stopWatchdog, stopGpsInterval, clearConfigureTimeout]);

  // ─── TransportManager status handler ─────────────────────────────────────
  // Defined as useCallback so it's stable; stored in a ref so TransportManager
  // always calls the latest version without needing re-initialization.
  const handleTransportStatus = useCallback(
    (event: StatusUpdateEvent) => {
      const { tempId, transport, status, finalPacketId, error } = event;

      if (transport === 'device') {
        if (status === 'acked') {
          // Register the real HW packet ID for RF/MQTT dedup of future incoming echoes
          if (finalPacketId !== undefined) isDuplicate(finalPacketId);
          setMessages((prev) =>
            prev.map((m) => (m.packetId === tempId ? { ...m, status: 'acked' as const } : m)),
          );
          void window.electronAPI.db.updateMessageStatus(tempId, 'acked');
        } else {
          // failed
          setMessages((prev) =>
            prev.map((m) =>
              m.packetId === tempId ? { ...m, status: 'failed' as const, error } : m,
            ),
          );
          void window.electronAPI.db.updateMessageStatus(tempId, 'failed', error);
        }
      } else {
        // mqtt — read current device status from state so the DB update is consistent
        setMessages((prev) => {
          const existing = prev.find((m) => m.packetId === tempId);
          if (status !== 'sending' && existing) {
            const deviceStatus = existing.status ?? 'acked';
            void window.electronAPI.db.updateMessageStatus(
              tempId,
              deviceStatus,
              existing.error,
              status,
            );
          }
          return prev.map((m) =>
            m.packetId === tempId ? { ...m, mqttStatus: status as ChatMessage['mqttStatus'] } : m,
          );
        });
      }
    },
    [isDuplicate],
  );

  // Keep the ref in sync so TransportManager always invokes the latest handler
  onStatusUpdateRef.current = handleTransportStatus;

  const sendMessage = useCallback(
    (text: string, channel = 0, destination?: number, replyId?: number) => {
      const hasMqtt = mqttStatusRef.current === 'connected';
      if (!deviceRef.current && !hasMqtt) throw new Error('Not connected');

      const from = myNodeNumRef.current > 0 ? myNodeNumRef.current : getOrCreateVirtualNodeId();
      const tempId = Math.floor(Math.random() * 0xffffffff);

      // Determine initial MQTT display state (TransportManager will confirm/update asynchronously)
      const chCfg = channelConfigsRef.current.find((c) => c.index === channel);
      const shouldUplink = !deviceRef.current
        ? hasMqtt // MQTT-only: always uplink when connected
        : !!(chCfg?.uplinkEnabled && hasMqtt && myNodeNumRef.current);

      const msg: ChatMessage = {
        sender_id: from,
        sender_name: getNodeName(from),
        payload: text,
        channel,
        timestamp: Date.now(),
        packetId: tempId,
        status: deviceRef.current ? ('sending' as const) : undefined,
        mqttStatus: shouldUplink ? ('sending' as const) : undefined,
        to: destination,
        replyId,
      };
      setMessages((prev) => [...prev, msg]);
      void window.electronAPI.db.saveMessage(msg);

      // For device path: track this tempId so the RF echo can be suppressed (avoids duplicate)
      if (deviceRef.current) {
        pendingTempIdRef.current = tempId;
      }

      // Lazy-init TransportManager (stable deps are all refs)
      transportManagerRef.current ??= new TransportManager({
        deviceRef,
        myNodeNumRef,
        mqttStatusRef,
        channelConfigsRef,
        isDuplicate,
        onStatusUpdateRef,
      });
      transportManagerRef.current.sendMessage(text, channel, destination, replyId, tempId, from);
    },
    [getNodeName, isDuplicate],
  );

  const setConfig = useCallback(async (config: unknown) => {
    if (!deviceRef.current) return;

    await deviceRef.current.setConfig(config as any);
  }, []);

  const commitConfig = useCallback(async () => {
    if (!deviceRef.current) return;
    await deviceRef.current.commitEditSettings();
  }, []);

  const setDeviceChannel = useCallback(
    async (args: {
      index: number;
      role: number;
      settings: {
        name: string;
        psk: Uint8Array;
        uplinkEnabled: boolean;
        downlinkEnabled: boolean;
        positionPrecision: number;
      };
    }) => {
      if (!deviceRef.current) return;
      const channel = create(ProtobufChannel.ChannelSchema, {
        index: args.index,
        role: args.role,
        settings: create(ProtobufChannel.ChannelSettingsSchema, {
          name: args.settings.name,
          psk: args.settings.psk,
          uplinkEnabled: args.settings.uplinkEnabled,
          downlinkEnabled: args.settings.downlinkEnabled,
          moduleSettings: create(ProtobufChannel.ModuleSettingsSchema, {
            positionPrecision: args.settings.positionPrecision,
          }),
        }),
      }) as ChannelType;
      await deviceRef.current.setChannel(channel);
    },
    [],
  );

  const clearChannel = useCallback(async (index: number) => {
    if (!deviceRef.current) return;
    await deviceRef.current.clearChannel(index);
  }, []);

  const setOwner = useCallback(
    async (owner: { longName: string; shortName: string; isLicensed: boolean }) => {
      if (!deviceRef.current) return;
      const user = create(Mesh.UserSchema, {
        longName: owner.longName,
        shortName: owner.shortName,
        isLicensed: owner.isLicensed,
      }) as UserType;
      await deviceRef.current.setOwner(user);
    },
    [],
  );

  const reboot = useCallback(async (delay: number) => {
    if (!deviceRef.current) return;
    await deviceRef.current.reboot(delay);
  }, []);

  const shutdown = useCallback(async (delay: number) => {
    if (!deviceRef.current) return;
    await deviceRef.current.shutdown(delay);
  }, []);

  const factoryReset = useCallback(async () => {
    if (!deviceRef.current) return;
    await deviceRef.current.factoryResetDevice();
  }, []);

  const resetNodeDb = useCallback(async () => {
    if (!deviceRef.current) return;
    await deviceRef.current.resetNodes();
  }, []);

  const rebootOta = useCallback(async (delay = 2) => {
    if (!deviceRef.current) return;
    await deviceRef.current.rebootOta(delay);
  }, []);

  const enterDfuMode = useCallback(async () => {
    if (!deviceRef.current) return;
    await deviceRef.current.enterDfuMode();
  }, []);

  const factoryResetConfig = useCallback(async () => {
    if (!deviceRef.current) return;
    await deviceRef.current.factoryResetConfig();
  }, []);

  const sendWaypoint = useCallback(
    async (wp: Omit<MeshWaypoint, 'from' | 'timestamp'>, dest = 0xffffffff, channel = 0) => {
      if (!deviceRef.current) return;
      const waypoint = create(Mesh.WaypointSchema, {
        id: wp.id,
        latitudeI: Math.round(wp.latitude * 1e7),
        longitudeI: Math.round(wp.longitude * 1e7),
        name: wp.name,
        description: wp.description ?? '',
        icon: wp.icon ?? 0,
        lockedTo: wp.lockedTo ?? 0,
        expire: wp.expire ?? 0,
      }) as WaypointType;
      await deviceRef.current.sendWaypoint(waypoint, dest, channel);
    },
    [],
  );

  const deleteWaypoint = useCallback(async (id: number) => {
    if (!deviceRef.current) return;
    const waypoint = create(Mesh.WaypointSchema, { id, expire: 1 }) as WaypointType;
    await deviceRef.current.sendWaypoint(waypoint, 0xffffffff, 0);
  }, []);

  const setModuleConfig = useCallback(async (config: unknown) => {
    if (!deviceRef.current) return;
    await (deviceRef.current as any).setModuleConfig(config);
  }, []);

  const setCannedMessages = useCallback(async (messages: string[]) => {
    if (!deviceRef.current) return;
    await (deviceRef.current as any).setCannedMessages({ messages: messages.join('\n') });
  }, []);

  const [ringtone, setRingtoneState] = useState<string>('');

  const setRingtone = useCallback(async (ringtoneStr: string) => {
    if (!deviceRef.current) return;
    const msg = create(Admin.AdminMessageSchema, {
      payloadVariant: { case: 'setRingtoneMessage', value: ringtoneStr },
    });
    await (deviceRef.current as any).sendPacket(
      toBinary(Admin.AdminMessageSchema, msg),
      Portnums.PortNum.ADMIN_APP,
      'self',
    );
    setRingtoneState(ringtoneStr);
  }, []);

  const requestPosition = useCallback(async (nodeNum: number) => {
    if (!deviceRef.current) return;
    await deviceRef.current.requestPosition(nodeNum);
  }, []);

  const traceRoute = useCallback(async (nodeNum: number) => {
    if (!deviceRef.current) return;
    await deviceRef.current.traceRoute(nodeNum);
  }, []);

  const deleteNode = useCallback(
    async (nodeId: number) => {
      await window.electronAPI.db.deleteNode(nodeId);
      console.debug(
        `[useDevice] deleteNode: removed 0x${nodeId.toString(16).toUpperCase()} from memory`,
      );
      updateNodes((prev) => {
        const updated = new Map(prev);
        updated.delete(nodeId);
        return updated;
      });
    },
    [updateNodes],
  );

  const refreshNodesFromDb = useCallback(() => {
    window.electronAPI.db
      .getNodes()
      .then((savedNodes) => {
        const nodeMap = new Map<number, MeshNode>();
        for (const n of savedNodes) {
          const long_name = n.long_name ?? '';
          nodeMap.set(n.node_id, {
            ...n,
            long_name,
            short_name: meshtasticShortNameAfterClearingDefault(
              long_name,
              n.short_name ?? '',
              n.node_id,
            ),
            role: parseNodeRole(n.role),
            favorited: Boolean(n.favorited),
            // Restore MQTT-only status from persisted source so these nodes show
            // the globe indicator and suppressed hop count until heard via RF.
            heard_via_mqtt_only: n.source === 'mqtt',
          });
        }
        console.debug(`[useDevice] refreshNodesFromDb: loaded ${nodeMap.size} nodes`);
        nodesRef.current = nodeMap;
        setNodes(nodeMap);
      })
      .catch((err: unknown) => {
        console.error('[useDevice] Failed to refresh nodes:', err);
      });
  }, []);

  const refreshMessagesFromDb = useCallback(() => {
    window.electronAPI.db
      .getMessages(undefined, getMessageLoadLimit())
      .then((msgs) => {
        console.debug(`[useDevice] refreshMessagesFromDb: loaded ${msgs.length} messages`);
        setMessages(msgs.reverse());
      })
      .catch((err: unknown) => {
        console.error('[useDevice] Failed to refresh messages:', err);
        setMessages([]);
      });
  }, []);

  const setNodeFavorited = useCallback(
    async (nodeId: number, favorited: boolean) => {
      await window.electronAPI.db.setNodeFavorited(nodeId, favorited);
      updateNodes((prev) => {
        const updated = new Map(prev);
        const existing = updated.get(nodeId);
        if (existing) updated.set(nodeId, { ...existing, favorited });
        return updated;
      });
    },
    [updateNodes],
  );

  const refreshOurPosition = useCallback(async (): Promise<OurPosition | null> => {
    setGpsLoading(true);
    try {
      const myNode = nodesRef.current.get(myNodeNumRef.current);
      let staticLat: number | undefined;
      let staticLon: number | undefined;
      try {
        const s =
          parseStoredJson<{ staticLat?: number; staticLon?: number }>(
            localStorage.getItem('mesh-client:gpsSettings'),
            'useDevice refreshOurPosition gpsSettings',
          ) ?? {};
        if (typeof s.staticLat === 'number' && typeof s.staticLon === 'number') {
          staticLat = s.staticLat;
          staticLon = s.staticLon;
        }
      } catch {
        // catch-no-log-ok localStorage read for GPS settings — ignore parse errors
      }
      // When a static position is set, don't let device coords override it
      const devLat = staticLat != null ? undefined : myNode?.latitude;
      const devLon = staticLon != null ? undefined : myNode?.longitude;
      const pos = await resolveOurPosition(devLat, devLon, staticLat, staticLon);
      setOurPosition(pos);
      if (getStoredMeshProtocol() === 'meshtastic') {
        useDiagnosticsStore.getState().setOurPositionSource(pos?.source ?? null);
      }

      if (pos) {
        const hasDevice = !!deviceRef.current;
        const selfNodeId =
          hasDevice && myNodeNumRef.current > 0
            ? myNodeNumRef.current
            : mqttStatusRef.current === 'connected'
              ? getOrCreateVirtualNodeId()
              : 0;
        if (selfNodeId > 0) {
          const isVirtualNode = !hasDevice && selfNodeId === getOrCreateVirtualNodeId();
          updateNodes((prev) => {
            const updated = new Map(prev);
            const existing = updated.get(selfNodeId) ?? emptyNode(selfNodeId);
            const node: MeshNode = {
              ...existing,
              node_id: selfNodeId,
              latitude: pos.lat,
              longitude: pos.lon,
              last_heard: Date.now(),
              lastPositionWarning: undefined,
              ...(isVirtualNode
                ? { long_name: MQTT_ONLY_VIRTUAL_LONG_NAME, role: ROLE_CLIENT, hops_away: 0 }
                : {}),
            };
            updated.set(selfNodeId, node);
            if (!isVirtualNode) void window.electronAPI.db.saveNode(node);
            return updated;
          });
        }

        const isClientMute = nodesRef.current.get(myNodeNumRef.current)?.role === ROLE_CLIENT_MUTE;
        const wouldSendWithoutMute =
          deviceRef.current &&
          ((pos.source === 'static' && deviceGpsModeRef.current !== 1) ||
            (pos.source === 'browser' && deviceGpsModeRef.current === 2));
        const shouldSendToDevice = !isClientMute && wouldSendWithoutMute;

        if (shouldSendToDevice && deviceRef.current) {
          deviceRef.current
            .setPosition(
              create(Mesh.PositionSchema, {
                latitudeI: Math.round(pos.lat * 1e7),
                longitudeI: Math.round(pos.lon * 1e7),
                time: Math.floor(Date.now() / 1000),
              }) as PositionType,
            )
            .catch((e: unknown) => {
              console.debug('[useDevice] setPosition non-fatal', e);
            });
        }
      }
      return pos;
    } finally {
      setGpsLoading(false);
    }
  }, [updateNodes]);

  // Keep ref in sync so intervals/callbacks always call the latest version
  refreshOurPositionRef.current = refreshOurPosition;

  // Resolve position on app startup regardless of device connection
  useEffect(() => {
    void refreshOurPositionRef.current();
  }, []);

  const sendPositionToDevice = useCallback(async (lat: number, lon: number, alt?: number) => {
    if (!deviceRef.current) return;
    if (nodesRef.current.get(myNodeNumRef.current)?.role === ROLE_CLIENT_MUTE) return;
    await deviceRef.current.setPosition(
      create(Mesh.PositionSchema, {
        latitudeI: Math.round(lat * 1e7),
        longitudeI: Math.round(lon * 1e7),
        altitude: alt ?? 0,
        time: Math.floor(Date.now() / 1000),
      }) as PositionType,
    );
  }, []);

  const updateGpsInterval = useCallback(
    (secs: number) => {
      stopGpsInterval();
      if (secs > 0) {
        gpsIntervalRef.current = setInterval(() => {
          refreshOurPositionRef.current().catch((err: unknown) => {
            console.error('[useDevice] GPS interval refresh error:', err);
          });
        }, secs * 1000);
      }
    },
    [stopGpsInterval],
  );

  const requestRefresh = useCallback(async () => {
    if (!deviceRef.current) return;
    await deviceRef.current.configure();
  }, []);

  const sendReaction = useCallback(
    async (emoji: number, replyId: number, channel: number) => {
      const hasMqtt = mqttStatusRef.current === 'connected';
      if (!deviceRef.current && !hasMqtt) throw new Error('Not connected');

      const from = myNodeNumRef.current;
      const msg: ChatMessage = {
        sender_id: from,
        sender_name: getNodeName(from),
        payload: '',
        channel,
        timestamp: Date.now(),
        emoji,
        replyId,
      };

      // Optimistic update — dedup guard in echo handler prevents duplicate when echo arrives
      setMessages((prev) => {
        const isDup = prev.some(
          (m) => m.emoji === emoji && m.replyId === replyId && m.sender_id === from,
        );
        if (isDup) return prev;
        return [...prev, msg];
      });
      void window.electronAPI.db.saveMessage(msg);

      // Device transport
      if (deviceRef.current) {
        await deviceRef.current.sendText('', 'broadcast', true, channel, replyId, emoji);
      }

      // MQTT transport (MQTT-only connections or uplink-enabled gateway)
      if (hasMqtt) {
        const chCfg = channelConfigsRef.current.find((c) => c.index === channel);
        if (chCfg?.uplinkEnabled || !deviceRef.current) {
          window.electronAPI.mqtt
            .publish({ text: '', from, channel, emoji, replyId })
            .catch((e: unknown) => {
              console.warn('[useDevice] sendReaction MQTT failed', e);
            });
        }
      }
    },
    [getNodeName],
  );

  const sendStatusEvents = useCallback(() => {
    const activeStatuses = ['connected', 'configured', 'stale', 'reconnecting'];
    if (activeStatuses.includes(state.status)) {
      window.electronAPI.notifyDeviceConnected();
    } else if (state.status === 'disconnected') {
      window.electronAPI.notifyDeviceDisconnected();
    }
  }, [state.status]);

  useEffect(() => {
    sendStatusEvents();
  }, [sendStatusEvents]);

  useEffect(() => {
    if (state.status === 'disconnected') {
      setTelemetryDeviceUpdateInterval(null);
    }
  }, [state.status]);

  const telemetryEnabled =
    telemetryDeviceUpdateInterval === null ? null : telemetryDeviceUpdateInterval > 0;

  const selfNodeId =
    state.myNodeNum > 0
      ? state.myNodeNum
      : mqttStatus === 'connected'
        ? getOrCreateVirtualNodeId()
        : 0;

  const getNodes = useCallback(() => nodesRef.current, []);

  return {
    state,
    mqttStatus,
    messages,
    nodes,
    telemetry,
    signalTelemetry,
    environmentTelemetry,
    channels,
    channelConfigs,
    traceRouteResults,
    ourPosition,
    selfNodeId,
    deviceGpsMode,
    telemetryEnabled,
    telemetryDeviceUpdateInterval,
    connect,
    connectAutomatic,
    disconnect,
    sendMessage,
    sendReaction,
    setConfig,
    commitConfig,
    setDeviceChannel,
    clearChannel,
    reboot,
    shutdown,
    factoryReset,
    resetNodeDb,
    requestPosition,
    traceRoute,
    deleteNode,
    setNodeFavorited,
    refreshNodesFromDb,
    refreshMessagesFromDb,
    requestRefresh,
    gpsLoading,
    refreshOurPosition,
    sendPositionToDevice,
    updateGpsInterval,
    getNodeName,
    getPickerStyleNodeLabel,
    getFullNodeLabel,
    getNodes,
    deviceOwner,
    setOwner,
    queueStatus,
    deviceLogs,
    neighborInfo,
    waypoints,
    rebootOta,
    enterDfuMode,
    factoryResetConfig,
    sendWaypoint,
    deleteWaypoint,
    moduleConfigs,
    setModuleConfig,
    setCannedMessages,
    ringtone,
    setRingtone,
    securityConfig,
    // ─── Additional packet type state ───────────────────────────────
    remoteHardwareMessages,
    audioMessages,
    detectionSensorEvents,
    pingResponses,
    ipTunnelMessages,
    paxCounterData,
    serialMessages,
    storeForwardMessages,
    rangeTestPackets,
    zpsMessages,
    simulatorPackets,
    atakMessages,
    mapReports,
    privateMessages,
  };
}

// ─── Helper functions ──

// Maps legacy string role labels (stored by older app versions) to numeric IDs
const LEGACY_ROLE_STRINGS: Record<string, number> = {
  Client: 0,
  Mute: 1,
  Router: 2,
  'Rtr+Client': 3,
  Repeater: 4,
  Tracker: 5,
  Sensor: 6,
  TAK: 7,
  Hidden: 8,
  'L&F': 9,
  'TAK Tracker': 10,
  'Rtr Late': 11,
  Base: 12,
};

function parseNodeRole(val: unknown): number | undefined {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = parseInt(val, 10);
    if (!isNaN(n)) return n;
    return LEGACY_ROLE_STRINGS[val];
  }
  return undefined;
}

export function emptyNode(nodeId: number): MeshNode {
  return {
    node_id: nodeId,
    short_name: '',
    long_name: '',
    hw_model: '',
    snr: 0,
    battery: 0,
    last_heard: 0,
    latitude: null,
    longitude: null,
    role: undefined,
  };
}

export function computeNodeInfoLastHeardMs(
  infoLastHeard: number | undefined,
  existingLastHeard: number,
  isSelf: boolean,
): number {
  return (infoLastHeard ?? 0) > 0
    ? infoLastHeard! * 1000
    : existingLastHeard || (isSelf ? Date.now() : 0);
}

export function createChatStubNode(nodeId: number, source: 'rf' | 'mqtt'): MeshNode {
  const base = emptyNode(nodeId);
  return {
    ...base,
    long_name: '',
    short_name: '',
    source,
    heard_via_mqtt_only: source === 'mqtt',
    last_heard: Date.now(),
  };
}
