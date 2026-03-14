import { create } from '@bufbuild/protobuf';
import type { MeshDevice } from '@meshtastic/core';
import { Channel as ProtobufChannel, Mesh, Portnums } from '@meshtastic/protobufs';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearCapturedBleDevice,
  createConnection,
  reconnectBle,
  reconnectSerial,
  safeDisconnect,
} from '../lib/connection';
import { validateCoords } from '../lib/coordUtils';
import type { OurPosition } from '../lib/gpsSource';
import { resolveOurPosition } from '../lib/gpsSource';
import { parseStoredJson } from '../lib/parseStoredJson';
import { normalizeReactionEmoji } from '../lib/reactions';
import { TransportManager } from '../lib/transport/TransportManager';
import type { StatusUpdateEvent } from '../lib/transport/types';
import type {
  ChatMessage,
  ConnectionType,
  DeviceState,
  MeshNode,
  MQTTStatus,
  TelemetryPoint,
} from '../lib/types';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';

function getMessageLoadLimit(): number {
  const s = parseStoredJson<{
    messageLimitEnabled?: boolean;
    messageLimitCount?: number;
  }>(localStorage.getItem('mesh-client:adminSettings'), 'useDevice getMessageLoadLimit');
  if (!s) return 1000;
  if (s.messageLimitEnabled === false) return 10000;
  return Math.max(1, s.messageLimitCount ?? 1000);
}

const MAX_TELEMETRY_POINTS = 50;
const POLL_INTERVAL_MS = 30_000; // 30 seconds
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
const BLE_HEARTBEAT_INTERVAL_MS = 30_000; // 30s heartbeat for BLE

function getOrCreateVirtualNodeId(): number {
  const key = 'mesh-client:mqttVirtualNodeId';
  const existing = localStorage.getItem(key);
  if (existing) {
    const n = parseInt(existing, 10);
    if (n > 0 && n < 0xffffffff) return n;
  }
  let id: number;
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
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
  const connectionParamsRef = useRef<{ type: ConnectionType; httpAddress?: string } | null>(null);
  const isReconnectingRef = useRef<boolean>(false);
  const reconnectGenerationRef = useRef<number>(0);
  const bleHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transportManagerRef = useRef<TransportManager | null>(null);
  const onStatusUpdateRef = useRef<(event: StatusUpdateEvent) => void>(() => {});
  // Tracks the tempId of an in-flight optimistic message (device path) so the echo can be skipped
  const pendingTempIdRef = useRef<number | undefined>(undefined);

  // ─── GPS tracking ─────────────────────────────────────────────
  const deviceGpsModeRef = useRef<number>(0); // 0=DISABLED,1=ENABLED,2=NOT_PRESENT
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshOurPositionRef = useRef<() => Promise<OurPosition | null>>(async () => null);

  // ─── MQTT session tracking ────────────────────────────────────
  // Tracks current MQTT connection status in a ref for use in callbacks
  const mqttStatusRef = useRef<MQTTStatus>('disconnected');
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
    return `!${nodeNum.toString(16)}`;
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
        return { ...s, status: 'configured', lastDataReceived: Date.now() };
      }
      return s;
    });
  }, []);

  // ─── Helper: start polling for node updates ─────────────────────
  const startPolling = useCallback(() => {
    if (pollRef.current) return; // Already polling
    pollRef.current = setInterval(() => {
      // Broadcast position request to all nodes
      deviceRef.current?.requestPosition(0xffffffff).catch((e) => {
        console.debug('[useDevice] requestPosition poll', e);
      });
    }, POLL_INTERVAL_MS);
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
      } catch {
        /* ignore */
      }
    }
    unsubscribesRef.current = [];
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

  // ─── Watchdog: stop BLE heartbeat ─────────────────────────────
  const stopBleHeartbeat = useCallback(() => {
    if (bleHeartbeatRef.current) {
      clearInterval(bleHeartbeatRef.current);
      bleHeartbeatRef.current = null;
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
          refreshOurPositionRef.current();
        }, intervalSecs * 1000);
      }
    } catch {
      /* ignore bad localStorage */
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
      if (elapsed > dead) {
        handleConnectionLostRef.current();
      } else if (elapsed > stale) {
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
        setMessages(msgs.reverse());
      })
      .catch((err) => {
        console.error('[useDevice] Failed to load messages:', err);
        setMessages([]);
      });
    window.electronAPI.db
      .getNodes()
      .then((savedNodes) => {
        const nodeMap = new Map<number, MeshNode>();
        for (const n of savedNodes) {
          nodeMap.set(n.node_id, {
            ...n,
            role: parseNodeRole(n.role),
            favorited: Boolean(n.favorited),
          });
        }
        nodesRef.current = nodeMap;
        setNodes(nodeMap);
      })
      .catch((err) => {
        console.error('[useDevice] Failed to load nodes:', err);
      });
  }, []);

  // ─── MQTT event subscriptions (independent of RF device) ──────
  useEffect(() => {
    const unsubStatus = window.electronAPI.mqtt.onStatus((s) => {
      mqttStatusRef.current = s as MQTTStatus;
      setMqttStatus(s as MQTTStatus);
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
          const existing = updated.get(virtualId) || emptyNode(virtualId);
          updated.set(virtualId, {
            ...existing,
            node_id: virtualId,
            long_name: MQTT_ONLY_VIRTUAL_LONG_NAME,
            role: ROLE_CLIENT,
            hops_away: 0,
          });
          return updated;
        });
      }
    });

    const unsubNode = window.electronAPI.mqtt.onNodeUpdate((rawNode) => {
      const nodeUpdate = rawNode as Partial<MeshNode> & {
        node_id: number;
        from_mqtt?: boolean;
        positionWarning?: string | null;
      };
      if (!nodeUpdate.node_id) return;

      updateNodes((prev) => {
        const existing = prev.get(nodeUpdate.node_id) || emptyNode(nodeUpdate.node_id);
        const heardViaRF = rfHeardNodeIds.current.has(nodeUpdate.node_id);
        const updated = new Map(prev);
        const node: MeshNode = {
          ...existing,
          ...nodeUpdate,
          heard_via_mqtt_only: !heardViaRF,
          heard_via_mqtt: true,
          source: heardViaRF ? 'rf' : 'mqtt',
          last_heard: nodeUpdate.last_heard ?? Date.now(),
        };
        // Don't overwrite RF signal data with MQTT-sourced node data
        if (!heardViaRF) {
          // MQTT-only: suppress RF metrics
          node.hops_away = existing.hops_away;
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
        updated.set(nodeUpdate.node_id, node);
        window.electronAPI.db.saveNode(node);
        return updated;
      });
      const updatedMqttNode = nodesRef.current.get(nodeUpdate.node_id);
      if (updatedMqttNode) {
        useDiagnosticsStore
          .getState()
          .processNodeUpdate(
            updatedMqttNode,
            nodesRef.current.get(myNodeNumRef.current) ?? null,
            myNodeNumRef.current,
          );
      }
    });

    const unsubMsg = window.electronAPI.mqtt.onMessage((rawMsg) => {
      const raw = rawMsg as Omit<ChatMessage, 'id'> & { from_mqtt?: boolean };
      const msg: Omit<ChatMessage, 'id'> & { from_mqtt?: boolean } =
        raw.emoji != null && raw.replyId != null
          ? { ...raw, emoji: normalizeReactionEmoji(raw.emoji, raw.payload) ?? raw.emoji }
          : raw;
      // Record MQTT path before dedup check (captures all copies, new and duplicate). Skip packetId 0 (no unique id per protobuf).
      const rawPacketId = Number(msg.packetId);
      const packetId = rawPacketId >>> 0;
      if (msg.sender_id && Number.isInteger(rawPacketId) && packetId !== 0) {
        useDiagnosticsStore.getState().recordPacketPath(packetId, msg.sender_id, {
          transport: 'mqtt',
          timestamp: Date.now(),
        });
      }

      // Packet ID dedup (catches our own uplink echoes)
      if (packetId !== 0 && isDuplicate(packetId)) {
        useDiagnosticsStore.getState().recordDuplicate(msg.sender_id);
        // Upgrade receivedVia to 'both' if this packet was already saved via RF
        setMessages((prev) =>
          prev.map((m) =>
            m.packetId === packetId && m.receivedVia === 'rf'
              ? { ...m, receivedVia: 'both' as const }
              : m,
          ),
        );
        if (packetId !== 0) window.electronAPI.db.updateMessageReceivedVia(packetId);
        return;
      }

      // If a device is connected, enforce downlink channel config
      if (deviceRef.current) {
        const chCfg = channelConfigsRef.current.find((c) => c.index === msg.channel);
        if (!chCfg?.downlinkEnabled) return; // drop: downlink not enabled for this channel

        // Re-transmit over RF. Firmware stamps `from` with the gateway's own node number,
        // so we prefix the payload with [MQTT:SHORT_NAME] to preserve attribution.
        const senderNode = nodesRef.current.get(msg.sender_id);
        const shortName = senderNode?.short_name ?? `!${msg.sender_id.toString(16)}`;
        const prefixedPayload = `[MQTT:${shortName}] ${msg.payload}`;
        deviceRef.current.sendText(prefixedPayload, 'broadcast', true, msg.channel).catch((e) => {
          console.debug('[useDevice] MQTT downlink sendText non-fatal', e);
        });
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
      window.electronAPI.db.saveMessage(mqttMsg);
    });

    return () => {
      unsubStatus();
      unsubNode();
      unsubMsg();
    };
  }, [updateNodes, isDuplicate, startGpsInterval]);

  // Cleanup on unmount — stop all intervals and subscriptions
  useEffect(() => {
    return () => {
      cleanupSubscriptions();
      stopPolling();
      stopWatchdog();
      stopBleHeartbeat();
      stopGpsInterval();
      isReconnectingRef.current = false;
      const device = deviceRef.current;
      deviceRef.current = null;
      if (device) {
        safeDisconnect(device).catch((e) => {
          console.debug('[useDevice] unmount safeDisconnect', e);
        });
      }
    };
  }, [cleanupSubscriptions, stopPolling, stopWatchdog, stopBleHeartbeat, stopGpsInterval]);

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

        // Start polling + watchdog when configured
        if (status === 7) {
          lastDataReceivedRef.current = Date.now();
          startPolling();
          startWatchdog();
          refreshOurPositionRef.current();
          startGpsInterval();
        }

        // Always clean up on disconnect, even if we never reached configured
        if (status === 2) {
          stopBleHeartbeat();
          stopWatchdog();
          stopGpsInterval();
          cleanupSubscriptions();
          stopPolling();
          setTraceRouteResults(new Map());
          deviceRef.current = null;
          setState((s) => ({
            ...s,
            status: 'disconnected',
            connectionType: null,
            firmwareVersion: undefined,
          }));
        }
      });
      unsubscribesRef.current.push(unsub1);

      // ─── My node info ──────────────────────────────────────────
      const unsub2 = device.events.onMyNodeInfo.subscribe((info) => {
        touchLastData();
        const virtualNodeId = getOrCreateVirtualNodeId();
        if (virtualNodeId !== info.myNodeNum) {
          window.electronAPI.db.deleteNode(virtualNodeId).catch((e) => {
            console.debug('[useDevice] deleteNode virtual', e);
          });
        }
        myNodeNumRef.current = info.myNodeNum;
        setState((s) => ({ ...s, myNodeNum: info.myNodeNum }));
        updateNodes((prev) => {
          const updated = new Map(prev);
          if (virtualNodeId !== info.myNodeNum) updated.delete(virtualNodeId);
          const existing = updated.get(info.myNodeNum);
          if (!existing) {
            const selfNode = { ...emptyNode(info.myNodeNum), hops_away: 0 };
            updated.set(info.myNodeNum, selfNode);
          } else {
            const selfNode = { ...existing, hops_away: 0 };
            updated.set(info.myNodeNum, selfNode);
            window.electronAPI.db.saveNode(selfNode);
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

        touchLastData();
        const isEcho = meshPacket.from === myNodeNumRef.current;
        const payloadText = new TextDecoder().decode(dataPacket.payload);
        const data = dataPacket as { replyId?: number; reply_id?: number; emoji?: number };
        const replyId = data.replyId ?? data.reply_id ?? undefined;
        const wireEmoji = data.emoji;
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
          window.electronAPI.db.updateMessageReceivedVia(rfDedupPacketId);
          return;
        }

        // If we have an optimistic message in state for this send, skip the echo to avoid a duplicate
        if (isEcho && pendingTempIdRef.current !== undefined) {
          pendingTempIdRef.current = undefined;
          return;
        }

        const rfMsg: ChatMessage = isEcho ? msg : { ...msg, receivedVia: 'rf' as const };
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
          return [...prev, rfMsg];
        });
        window.electronAPI.db.saveMessage(rfMsg);

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
              .catch((e) => {
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
        };
        updateNodes((prev) => {
          const updated = new Map(prev);
          const existing = updated.get(packet.from) || emptyNode(packet.from);
          const node: MeshNode = {
            ...existing,
            node_id: packet.from,
            long_name: user.longName ?? existing.long_name,
            short_name: user.shortName ?? existing.short_name,
            hw_model: String(user.hwModel ?? existing.hw_model),
            // User packets are often replayed from the device DB at connect; do not
            // bump last_hear to now or offline nodes appear freshly heard.
            last_heard: existing.last_heard,
            heard_via_mqtt_only: false,
            source: 'rf',
          };
          updated.set(packet.from, node);
          window.electronAPI.db.saveNode(node);
          return updated;
        });
        if (packet.from === myNodeNumRef.current) {
          setDeviceOwner({
            longName: user.longName ?? '',
            shortName: user.shortName ?? '',
            isLicensed: (user as { isLicensed?: boolean }).isLicensed ?? false,
          });
        }
      });
      unsubscribesRef.current.push(unsub4);

      // ─── Node info packets ─────────────────────────────────────
      const unsub5 = device.events.onNodeInfoPacket.subscribe((packet) => {
        touchLastData();
        rfHeardNodeIds.current.add((packet as any).num ?? (packet as any).from);
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

        updateNodes((prev) => {
          const updated = new Map(prev);
          const existing = updated.get(nodeNum) || emptyNode(nodeNum);

          let newLat = existing.latitude;
          let newLon = existing.longitude;
          let newAlt = info.position?.altitude ?? existing.altitude;
          let posWarn: string | undefined = existing.lastPositionWarning;

          if (info.position?.latitudeI != null || info.position?.longitudeI != null) {
            const lat = (info.position.latitudeI ?? 0) / 1e7;
            const lon = (info.position.longitudeI ?? 0) / 1e7;
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

          const lastHeardMs =
            (info.lastHeard ?? 0) > 0 ? info.lastHeard! * 1000 : existing.last_heard;
          const staleHopMs = 2 * 3_600_000; // align with nodeStatus STALE_MS
          const lastHeardStale = lastHeardMs > 0 && Date.now() - lastHeardMs > staleHopMs;

          const node: MeshNode = {
            ...existing,
            node_id: nodeNum,
            long_name: info.user?.longName ?? existing.long_name,
            short_name: info.user?.shortName ?? existing.short_name,
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
          window.electronAPI.db.saveNode(node);
          return updated;
        });
        const updatedRfNode = nodesRef.current.get(nodeNum);
        if (updatedRfNode) {
          useDiagnosticsStore
            .getState()
            .processNodeUpdate(
              updatedRfNode,
              nodesRef.current.get(myNodeNumRef.current) ?? null,
              myNodeNumRef.current,
            );
        }
        if (type === 'ble' && nodeNum === myNodeNumRef.current) {
          const btDevice = (device.transport as any)?.__bluetoothDevice;
          const shortName = info.user?.shortName ?? null;
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
              /* ignore */
            }
          }
        }
      });
      unsubscribesRef.current.push(unsub5);

      // ─── Position packets ──────────────────────────────────────
      const unsub6 = device.events.onPositionPacket.subscribe((packet) => {
        touchLastData();
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
            const existing = updated.get(packet.from) || emptyNode(packet.from);
            // Don't flag our own node if we have valid fallback coords
            if (
              packet.from === myNodeNumRef.current &&
              (existing.latitude !== 0 || existing.longitude !== 0)
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
          const existing = updated.get(packet.from) || emptyNode(packet.from);

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
          window.electronAPI.db.saveNode(node);
          return updated;
        });
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
            };
          };
        };

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
              window.electronAPI.db.saveNode(node);
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
        if (metrics.batteryLevel && packet.from) {
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
        };
        if (!mp.from) return;

        // Record RF path for packet redundancy tracking (skip id 0 — protobuf: no unique id for no-ack/non-broadcast)
        const rawId = Number(mp.id);
        const packetId = rawId >>> 0;
        if (Number.isInteger(rawId) && packetId !== 0) {
          useDiagnosticsStore.getState().recordPacketPath(packetId, mp.from, {
            transport: 'rf',
            snr: mp.rxSnr,
            rssi: mp.rxRssi,
            timestamp: Date.now(),
          });
        }

        if (mp.rxSnr || mp.rxRssi) {
          updateNodes((prev) => {
            const updated = new Map(prev);
            const existing = updated.get(mp.from!);
            if (existing) {
              const node: MeshNode = {
                ...existing,
                ...(mp.rxSnr ? { snr: mp.rxSnr } : {}),
                ...(mp.rxRssi ? { rssi: mp.rxRssi } : {}),
                // Do not bump last_heard here — mesh packets at connect can be
                // replayed/history; SNR/RSSI alone is not proof of a fresh hear.
              };
              updated.set(mp.from!, node);
              window.electronAPI.db.saveNode(node);
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

      // ─── BLE heartbeat with failure detection ──────────────────
      // HTTP transport does not need a heartbeat — the 3s fromradio poll
      // and onMeshHeartbeat keep the connection alive. heartbeat() for HTTP
      // uses the queue with a 60s auto-resolve timeout (no real device ACK),
      // so awaiting it would call touchLastData() 60s late and mask dead
      // connections from the watchdog.
      if (type === 'ble') {
        bleHeartbeatRef.current = setInterval(async () => {
          try {
            await deviceRef.current?.heartbeat();
            touchLastData();
          } catch (err) {
            // "GATT operation already in progress" means a concurrent read or write is
            // happening — the connection is still alive, so skip this beat rather than
            // triggering a false disconnect.
            if (String(err).includes('GATT operation already in progress')) {
              console.debug('[BLE heartbeat] GATT busy — skipping beat, connection intact');
              return;
            }
            console.warn('[Meshtastic] BLE heartbeat write failed:', err);
            // Any other GATT write failure = connection is dead
            handleConnectionLostRef.current();
          }
        }, BLE_HEARTBEAT_INTERVAL_MS);
      }

      // ─── Serial heartbeat (existing behavior, keeps device alive)
      if (type === 'serial') {
        device.setHeartbeatInterval(60_000);
      }

      // ─── GATT disconnection event (Layer 3) ────────────────────
      if (type === 'ble') {
        const btDevice = (device.transport as any)?.__bluetoothDevice;
        if (btDevice) {
          const onGattDisconnected = () => {
            console.warn('[useDevice] GATT server disconnected event fired');
            handleConnectionLostRef.current();
          };
          btDevice.addEventListener('gattserverdisconnected', onGattDisconnected);
          unsubscribesRef.current.push(() => {
            btDevice.removeEventListener('gattserverdisconnected', onGattDisconnected);
          });
        }
      }
    },
    [
      touchLastData,
      getNodeName,
      updateNodes,
      startPolling,
      stopPolling,
      startWatchdog,
      stopWatchdog,
      stopBleHeartbeat,
      cleanupSubscriptions,
      startGpsInterval,
      stopGpsInterval,
      isDuplicate,
    ],
  );

  // ─── Connection lost handler ──────────────────────────────────
  const handleConnectionLost = useCallback(() => {
    if (isReconnectingRef.current) return;
    isReconnectingRef.current = true;

    // Clean up existing connection
    cleanupSubscriptions();
    stopPolling();
    stopWatchdog();
    stopBleHeartbeat();
    stopGpsInterval();
    const oldDevice = deviceRef.current;
    deviceRef.current = null;
    if (oldDevice)
      safeDisconnect(oldDevice).catch((e) => {
        console.debug('[useDevice] handleConnectionLost safeDisconnect', e);
      });

    // Begin reconnection
    attemptReconnectRef.current();
  }, [cleanupSubscriptions, stopPolling, stopWatchdog, stopBleHeartbeat, stopGpsInterval]);

  // Keep the ref in sync
  handleConnectionLostRef.current = handleConnectionLost;

  // ─── Reconnection with exponential backoff ────────────────────
  const attemptReconnect = useCallback(async () => {
    const params = connectionParamsRef.current;
    if (!params) {
      isReconnectingRef.current = false;
      setState((s) => ({ ...s, status: 'disconnected', connectionType: null }));
      return;
    }

    if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      isReconnectingRef.current = false;
      reconnectAttemptRef.current = 0;
      setState((s) => ({ ...s, status: 'disconnected', connectionType: null }));
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
    await new Promise((r) => setTimeout(r, delay));

    // Check if user manually disconnected or started a new connection during the wait
    if (!isReconnectingRef.current || reconnectGenerationRef.current !== generation) return;

    try {
      let device: MeshDevice;
      if (params.type === 'ble') {
        // Try BLE reconnection without user gesture
        device = await reconnectBle();
      } else {
        device = await createConnection(params.type, params.httpAddress);
      }
      deviceRef.current = device;
      wireSubscriptions(device, params.type);
      device.configure();

      // Success
      reconnectAttemptRef.current = 0;
      isReconnectingRef.current = false;
    } catch (err) {
      console.warn(`[Meshtastic] Reconnect attempt ${reconnectAttemptRef.current} failed:`, err);
      // Retry
      attemptReconnectRef.current();
    }
  }, [wireSubscriptions]);

  // Keep the ref in sync
  attemptReconnectRef.current = attemptReconnect;

  // ─── Connect ──────────────────────────────────────────────────
  const connect = useCallback(
    async (type: ConnectionType, httpAddress?: string) => {
      // Force-disconnect stale device before creating a new connection
      if (deviceRef.current) {
        cleanupSubscriptions();
        stopPolling();
        stopWatchdog();
        stopBleHeartbeat();
        const oldDevice = deviceRef.current;
        deviceRef.current = null;
        safeDisconnect(oldDevice).catch((e) => {
          console.debug('[useDevice] connect safeDisconnect prior', e);
        });
      }

      // Store connection params for reconnection
      connectionParamsRef.current = { type, httpAddress };
      reconnectAttemptRef.current = 0;
      isReconnectingRef.current = false;
      reconnectGenerationRef.current++;

      setState((s) => ({ ...s, status: 'connecting', connectionType: type }));

      try {
        console.debug('[useDevice] connect', type, httpAddress);
        const device = await createConnection(type, httpAddress);
        deviceRef.current = device;

        // Wire all event subscriptions
        wireSubscriptions(device, type);

        // Start configuration AFTER all listeners are wired
        device.configure();
      } catch (err) {
        console.error('[Meshtastic] Connection failed:', err);
        cleanupSubscriptions();
        stopPolling();
        stopWatchdog();
        stopBleHeartbeat();
        deviceRef.current = null;
        setState({
          status: 'disconnected',
          myNodeNum: 0,
          connectionType: null,
        });
        throw err;
      }
    },
    [wireSubscriptions, cleanupSubscriptions, stopPolling, stopWatchdog, stopBleHeartbeat],
  );

  /**
   * Like connect(), but uses gesture-free reconnect paths for BLE/serial.
   * Called by auto-connect on startup, which runs outside a user gesture.
   * @param lastSerialPortId - Stored portId from previous manual selection (serial only).
   */
  const connectAutomatic = useCallback(
    async (type: ConnectionType, httpAddress?: string, lastSerialPortId?: string | null) => {
      if (deviceRef.current) {
        cleanupSubscriptions();
        stopPolling();
        stopWatchdog();
        stopBleHeartbeat();
        const oldDevice = deviceRef.current;
        deviceRef.current = null;
        safeDisconnect(oldDevice).catch((e) => {
          console.debug('[useDevice] connectAutomatic safeDisconnect prior', e);
        });
      }

      connectionParamsRef.current = { type, httpAddress };
      reconnectAttemptRef.current = 0;
      isReconnectingRef.current = false;
      reconnectGenerationRef.current++;

      setState((s) => ({ ...s, status: 'connecting', connectionType: type }));

      try {
        console.debug('[useDevice] connectAutomatic', type, httpAddress);
        let device: MeshDevice;
        if (type === 'ble') {
          device = await reconnectBle();
        } else if (type === 'serial') {
          device = await reconnectSerial(lastSerialPortId);
        } else {
          device = await createConnection(type, httpAddress);
        }
        deviceRef.current = device;
        wireSubscriptions(device, type);
        device.configure();
      } catch (err) {
        console.error('[Meshtastic] Auto-connect failed:', err);
        cleanupSubscriptions();
        stopPolling();
        stopWatchdog();
        stopBleHeartbeat();
        deviceRef.current = null;
        setState({ status: 'disconnected', myNodeNum: 0, connectionType: null });
        throw err;
      }
    },
    [wireSubscriptions, cleanupSubscriptions, stopPolling, stopWatchdog, stopBleHeartbeat],
  );

  const disconnect = useCallback(async () => {
    // Stop all monitoring and reconnection
    cleanupSubscriptions();
    stopPolling();
    stopWatchdog();
    stopBleHeartbeat();
    stopGpsInterval();
    clearCapturedBleDevice();
    isReconnectingRef.current = false;
    reconnectAttemptRef.current = 0;
    reconnectGenerationRef.current++;
    connectionParamsRef.current = null;

    const device = deviceRef.current;
    deviceRef.current = null;
    if (device) {
      await safeDisconnect(device);
    }
    setState({ status: 'disconnected', myNodeNum: 0, connectionType: null });
  }, [cleanupSubscriptions, stopPolling, stopWatchdog, stopBleHeartbeat, stopGpsInterval]);

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
          window.electronAPI.db.updateMessageStatus(tempId, 'acked');
        } else {
          // failed
          setMessages((prev) =>
            prev.map((m) =>
              m.packetId === tempId ? { ...m, status: 'failed' as const, error } : m,
            ),
          );
          window.electronAPI.db.updateMessageStatus(tempId, 'failed', error);
        }
      } else {
        // mqtt — read current device status from state so the DB update is consistent
        setMessages((prev) => {
          const existing = prev.find((m) => m.packetId === tempId);
          if (status !== 'sending' && existing) {
            const deviceStatus = existing.status ?? 'acked';
            window.electronAPI.db.updateMessageStatus(tempId, deviceStatus, existing.error, status);
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

      const from = myNodeNumRef.current || getOrCreateVirtualNodeId();
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
      window.electronAPI.db.saveMessage(msg);

      // For device path: track this tempId so the RF echo can be suppressed (avoids duplicate)
      if (deviceRef.current) {
        pendingTempIdRef.current = tempId;
      }

      // Lazy-init TransportManager (stable deps are all refs)
      if (!transportManagerRef.current) {
        transportManagerRef.current = new TransportManager({
          deviceRef,
          myNodeNumRef,
          mqttStatusRef,
          channelConfigsRef,
          isDuplicate,
          onStatusUpdateRef,
        });
      }
      transportManagerRef.current.sendMessage(text, channel, destination, replyId, tempId);
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
      });
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
      });
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
          nodeMap.set(n.node_id, {
            ...n,
            role: parseNodeRole(n.role),
            favorited: Boolean(n.favorited),
          });
        }
        nodesRef.current = nodeMap;
        setNodes(nodeMap);
      })
      .catch((err) => {
        console.error('[useDevice] Failed to refresh nodes:', err);
      });
  }, []);

  const refreshMessagesFromDb = useCallback(() => {
    window.electronAPI.db
      .getMessages(undefined, getMessageLoadLimit())
      .then((msgs) => {
        setMessages(msgs.reverse());
      })
      .catch((err) => {
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
        /* ignore */
      }
      // When a static position is set, don't let device coords override it
      const devLat = staticLat != null ? undefined : myNode?.latitude;
      const devLon = staticLon != null ? undefined : myNode?.longitude;
      const pos = await resolveOurPosition(devLat, devLon, staticLat, staticLon);
      setOurPosition(pos);
      useDiagnosticsStore.getState().setOurPositionSource(pos?.source ?? null);

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
            const existing = updated.get(selfNodeId) || emptyNode(selfNodeId);
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
            if (!isVirtualNode) window.electronAPI.db.saveNode(node);
            return updated;
          });
        }

        const shouldSendToDevice =
          deviceRef.current &&
          ((pos.source === 'static' && deviceGpsModeRef.current !== 1) ||
            (pos.source === 'browser' && deviceGpsModeRef.current === 2));

        if (shouldSendToDevice && deviceRef.current) {
          deviceRef.current
            .setPosition(
              create(Mesh.PositionSchema, {
                latitudeI: Math.round(pos.lat * 1e7),
                longitudeI: Math.round(pos.lon * 1e7),
                time: Math.floor(Date.now() / 1000),
              }),
            )
            .catch((e) => {
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
    refreshOurPositionRef.current();
  }, []);

  const sendPositionToDevice = useCallback(async (lat: number, lon: number, alt?: number) => {
    if (!deviceRef.current) return;
    await deviceRef.current.setPosition(
      create(Mesh.PositionSchema, {
        latitudeI: Math.round(lat * 1e7),
        longitudeI: Math.round(lon * 1e7),
        altitude: alt ?? 0,
        time: Math.floor(Date.now() / 1000),
      }),
    );
  }, []);

  const updateGpsInterval = useCallback(
    (secs: number) => {
      stopGpsInterval();
      if (secs > 0) {
        gpsIntervalRef.current = setInterval(() => {
          refreshOurPositionRef.current();
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

      const from = myNodeNumRef.current || 0;
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
      window.electronAPI.db.saveMessage(msg);

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
            .catch((e: unknown) => console.warn('[useDevice] sendReaction MQTT failed', e));
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

function emptyNode(nodeId: number): MeshNode {
  return {
    node_id: nodeId,
    short_name: '',
    long_name: '',
    hw_model: '',
    snr: 0,
    battery: 0,
    last_heard: 0,
    latitude: 0,
    longitude: 0,
  };
}
