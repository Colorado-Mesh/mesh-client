import { useState, useCallback, useRef, useEffect } from "react";
import type { MeshDevice } from "@meshtastic/core";
import { create } from "@bufbuild/protobuf";
import { Channel as ProtobufChannel, Portnums } from "@meshtastic/protobufs";
import { createConnection, reconnectBle, safeDisconnect, clearCapturedBleDevice } from "../lib/connection";
import { validateCoords } from "../lib/coordUtils";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import type {
  ConnectionType,
  DeviceState,
  ChatMessage,
  MeshNode,
  MQTTStatus,
  TelemetryPoint,
} from "../lib/types";

const MAX_TELEMETRY_POINTS = 50;
const POLL_INTERVAL_MS = 30_000; // 30 seconds
const BROADCAST_ADDR = 0xffffffff;

// ─── Connection watchdog thresholds (per transport) ────────────────
const BLE_STALE_THRESHOLD_MS = 90_000;    // 90s — show warning
const BLE_DEAD_THRESHOLD_MS = 180_000;    // 3min — trigger reconnect
const SERIAL_STALE_THRESHOLD_MS = 120_000; // 2min
const SERIAL_DEAD_THRESHOLD_MS = 300_000;  // 5min
const HTTP_STALE_THRESHOLD_MS = 60_000;    // 1min
const HTTP_DEAD_THRESHOLD_MS = 120_000;    // 2min
const WATCHDOG_INTERVAL_MS = 15_000;       // Check every 15s
const MAX_RECONNECT_ATTEMPTS = 5;
const BLE_HEARTBEAT_INTERVAL_MS = 30_000;  // 30s heartbeat for BLE

function getOrCreateVirtualNodeId(): number {
  const key = "mesh-client:mqttVirtualNodeId";
  const existing = localStorage.getItem(key);
  if (existing) {
    const n = parseInt(existing, 10);
    if (n > 0 && n < 0xffffffff) return n;
  }
  const id = ((Math.random() * 0x0FFFFFFF) >>> 0) + 1;
  localStorage.setItem(key, String(id));
  return id;
}

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
  const unsubscribesRef = useRef<Array<() => void>>([]);

  // ─── Connection watchdog refs ─────────────────────────────────
  const lastDataReceivedRef = useRef<number>(Date.now());
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const connectionParamsRef = useRef<{ type: ConnectionType; httpAddress?: string } | null>(null);
  const isReconnectingRef = useRef<boolean>(false);
  const reconnectGenerationRef = useRef<number>(0);
  const bleHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Carries replyId from sendMessage into the echo handler (packets are sequential)
  const pendingReplyIdRef = useRef<number | undefined>(undefined);

  // ─── MQTT session tracking ────────────────────────────────────
  // Tracks current MQTT connection status in a ref for use in callbacks
  const mqttStatusRef = useRef<MQTTStatus>("disconnected");
  // Nodes heard via RF this session — prevents MQTT-only flag from being set
  const rfHeardNodeIds = useRef<Set<number>>(new Set());
  // Dedup map shared between RF and MQTT handlers
  const seenPacketIds = useRef<Map<number, number>>(new Map());

  const [mqttStatus, setMqttStatus] = useState<MQTTStatus>("disconnected");

  const [state, setState] = useState<DeviceState>({
    status: "disconnected",
    myNodeNum: 0,
    connectionType: null,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nodes, setNodes] = useState<Map<number, MeshNode>>(new Map());
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const [signalTelemetry, setSignalTelemetry] = useState<TelemetryPoint[]>([]);
  const [traceRouteResults, setTraceRouteResults] = useState<
    Map<number, { route: number[]; from: number; timestamp: number }>
  >(new Map());
  const [channels, setChannels] = useState<
    Array<{ index: number; name: string }>
  >([{ index: 0, name: "Primary" }]);
  const [channelConfigs, setChannelConfigs] = useState<Array<{
    index: number;
    name: string;
    role: number;
    psk: Uint8Array;
    uplinkEnabled: boolean;
    downlinkEnabled: boolean;
    positionPrecision: number;
  }>>([]);

  // Keep nodesRef in sync with state
  const updateNodes = useCallback(
    (updater: (prev: Map<number, MeshNode>) => Map<number, MeshNode>) => {
      setNodes((prev) => {
        const next = updater(prev);
        nodesRef.current = next;
        return next;
      });
    },
    []
  );

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
      return node.long_name.length > 7
        ? node.long_name.slice(0, 7)
        : node.long_name;
    return `!${nodeNum.toString(16)}`;
  }, []);

  // Extended label: short_name + hex suffix, long_name, or hex fallback.
  // Used in the header for the connected node display.
  const getFullNodeLabel = useCallback((nodeNum: number): string => {
    const node = nodesRef.current.get(nodeNum);
    const hexId = `!${nodeNum.toString(16)}`;
    if (node?.short_name) {
      // Avoid double-appending hex if short_name already contains it
      return node.short_name.includes(hexId)
        ? node.short_name
        : `${node.short_name} ${hexId}`;
    }
    if (node?.long_name) return node.long_name;
    return hexId;
  }, []);

  // ─── Mark data as freshly received ────────────────────────────
  const touchLastData = useCallback(() => {
    lastDataReceivedRef.current = Date.now();
    // If we were in "stale" state, recover to "configured"
    setState((s) => {
      if (s.status === "stale") {
        return { ...s, status: "configured", lastDataReceived: Date.now() };
      }
      return s;
    });
  }, []);

  // ─── Helper: start polling for node updates ─────────────────────
  const startPolling = useCallback(() => {
    if (pollRef.current) return; // Already polling
    pollRef.current = setInterval(() => {
      // Broadcast position request to all nodes
      deviceRef.current?.requestPosition(0xffffffff).catch(() => {});
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
      try { unsub(); } catch { /* ignore */ }
    }
    unsubscribesRef.current = [];
  }, []);

  // ─── Watchdog: get thresholds per transport type ──────────────
  const getThresholds = useCallback(() => {
    const type = connectionParamsRef.current?.type;
    switch (type) {
      case "ble": return { stale: BLE_STALE_THRESHOLD_MS, dead: BLE_DEAD_THRESHOLD_MS };
      case "serial": return { stale: SERIAL_STALE_THRESHOLD_MS, dead: SERIAL_DEAD_THRESHOLD_MS };
      case "http": return { stale: HTTP_STALE_THRESHOLD_MS, dead: HTTP_DEAD_THRESHOLD_MS };
      default: return { stale: 90_000, dead: 180_000 };
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
          if (s.status === "configured" || s.status === "connected") {
            return { ...s, status: "stale", lastDataReceived: lastDataReceivedRef.current };
          }
          return s;
        });
      }
    }, WATCHDOG_INTERVAL_MS);
  }, [getThresholds]);

  // Load saved data from DB on mount
  useEffect(() => {
    window.electronAPI.db.getMessages(undefined, 500)
      .then((msgs) => { setMessages(msgs.reverse()); })
      .catch((err) => { console.error("[useDevice] Failed to load messages:", err); setMessages([]); });
    window.electronAPI.db.getNodes()
      .then((savedNodes) => {
        const nodeMap = new Map<number, MeshNode>();
        for (const n of savedNodes) {
          nodeMap.set(n.node_id, { ...n, role: parseNodeRole(n.role), favorited: Boolean(n.favorited) });
        }
        nodesRef.current = nodeMap;
        setNodes(nodeMap);
      })
      .catch((err) => { console.error("[useDevice] Failed to load nodes:", err); });
  }, []);

  // ─── MQTT event subscriptions (independent of RF device) ──────
  useEffect(() => {
    const unsubStatus = window.electronAPI.mqtt.onStatus((s) => {
      mqttStatusRef.current = s as MQTTStatus;
      setMqttStatus(s as MQTTStatus);
    });

    const unsubNode = window.electronAPI.mqtt.onNodeUpdate((rawNode) => {
      const nodeUpdate = rawNode as Partial<MeshNode> & { node_id: number; from_mqtt?: boolean; positionWarning?: string | null };
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
          source: heardViaRF ? "rf" : "mqtt",
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
        useDiagnosticsStore.getState().processNodeUpdate(
          updatedMqttNode,
          nodesRef.current.get(myNodeNumRef.current) ?? null
        );
      }
    });

    const unsubMsg = window.electronAPI.mqtt.onMessage((rawMsg) => {
      const msg = rawMsg as Omit<ChatMessage, "id"> & { from_mqtt?: boolean };
      if (msg.packetId && isDuplicate(msg.packetId)) {
        useDiagnosticsStore.getState().recordDuplicate(msg.sender_id);
        return;
      }
      // Deduplicate by content too (same sender + timestamp)
      setMessages((prev) => {
        const isDup = prev.some(
          (m) => m.sender_id === msg.sender_id && m.timestamp === msg.timestamp && m.payload === msg.payload
        );
        if (isDup) return prev;
        return [...prev, msg];
      });
      window.electronAPI.db.saveMessage(msg);
    });

    return () => {
      unsubStatus();
      unsubNode();
      unsubMsg();
    };
  }, [updateNodes, isDuplicate]);

  // Cleanup on unmount — stop all intervals and subscriptions
  useEffect(() => {
    return () => {
      cleanupSubscriptions();
      stopPolling();
      stopWatchdog();
      stopBleHeartbeat();
      isReconnectingRef.current = false;
      const device = deviceRef.current;
      deviceRef.current = null;
      if (device) {
        safeDisconnect(device).catch(() => {});
      }
    };
  }, [cleanupSubscriptions, stopPolling, stopWatchdog, stopBleHeartbeat]);

  // ─── Wire up all event subscriptions for a device ─────────────
  const wireSubscriptions = useCallback(
    (device: MeshDevice, type: ConnectionType) => {
      // Track whether the device reached "configured" state.
      let wasConfigured = false;

      // ─── Device status ─────────────────────────────────────────
      const unsub1 = device.events.onDeviceStatus.subscribe((status) => {
        touchLastData();
        const statusMap: Record<number, DeviceState["status"]> = {
          1: "connecting",   // DeviceRestarting
          2: "disconnected", // DeviceDisconnected
          3: "connecting",   // DeviceConnecting
          4: "connecting",   // DeviceReconnecting
          5: "connected",    // DeviceConnected
          6: "connecting",   // DeviceConfiguring
          7: "configured",   // DeviceConfigured
        };
        const mapped = statusMap[status] ?? "connected";
        setState((s) => ({ ...s, status: mapped }));

        // Start polling + watchdog when configured
        if (status === 7) {
          wasConfigured = true;
          lastDataReceivedRef.current = Date.now();
          startPolling();
          startWatchdog();
        }

        // Always clean up on disconnect, even if we never reached configured
        if (status === 2) {
          stopBleHeartbeat();
          stopWatchdog();
          cleanupSubscriptions();
          stopPolling();
          setTraceRouteResults(new Map());
          deviceRef.current = null;
          setState((s) => ({ ...s, status: "disconnected", connectionType: null }));
        }
      });
      unsubscribesRef.current.push(unsub1);

      // ─── My node info ──────────────────────────────────────────
      const unsub2 = device.events.onMyNodeInfo.subscribe((info) => {
        touchLastData();
        myNodeNumRef.current = info.myNodeNum;
        setState((s) => ({ ...s, myNodeNum: info.myNodeNum }));
        updateNodes((prev) => {
          if (prev.has(info.myNodeNum)) return prev;
          const updated = new Map(prev);
          updated.set(info.myNodeNum, emptyNode(info.myNodeNum));
          return updated;
        });
      });
      unsubscribesRef.current.push(unsub2);

      // ─── Text messages ─────────────────────────────────────────
      const unsub3 = device.events.onMeshPacket.subscribe((meshPacket) => {
        if (meshPacket.payloadVariant.case !== "decoded") return;
        const dataPacket = meshPacket.payloadVariant.value;
        if (dataPacket.portnum !== Portnums.PortNum.TEXT_MESSAGE_APP) return;

        touchLastData();
        const isEcho = meshPacket.from === myNodeNumRef.current;
        const emoji = dataPacket.emoji || undefined;
        const replyId = dataPacket.replyId
          || (isEcho ? pendingReplyIdRef.current : undefined)
          || undefined;
        if (isEcho) pendingReplyIdRef.current = undefined;

        const msg: ChatMessage = {
          sender_id: meshPacket.from,
          sender_name: getNodeName(meshPacket.from),
          payload: new TextDecoder().decode(dataPacket.payload),
          channel: meshPacket.channel ?? 0,
          timestamp: meshPacket.rxTime ? meshPacket.rxTime * 1000 : Date.now(),
          packetId: meshPacket.id,
          status: isEcho ? "sending" : undefined,
          emoji,
          replyId,
          to: meshPacket.to && meshPacket.to !== BROADCAST_ADDR ? meshPacket.to : undefined,
        };

        setMessages((prev) => {
          // Dedup reaction retransmissions before the DB write completes
          if (msg.emoji && msg.replyId) {
            const isDup = prev.some(
              (m) =>
                m.emoji === msg.emoji &&
                m.replyId === msg.replyId &&
                m.sender_id === msg.sender_id
            );
            if (isDup) return prev;
          }
          return [...prev, msg];
        });
        window.electronAPI.db.saveMessage(msg);

        // Desktop notification for incoming messages when app is not focused
        if (!isEcho && !emoji && document.hidden) {
          try {
            const title = msg.to
              ? `DM from ${msg.sender_name}`
              : `Message from ${msg.sender_name}`;
            new Notification(title, {
              body: msg.payload.slice(0, 100),
              silent: false,
            });
          } catch { /* notifications may not be available */ }
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
            last_heard: Date.now(),
            heard_via_mqtt_only: false,
            source: "rf",
          };
          updated.set(packet.from, node);
          window.electronAPI.db.saveNode(node);
          return updated;
        });
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
            } else {
              posWarn = r.warning;
            }
          }

          const node: MeshNode = {
            ...existing,
            node_id: nodeNum,
            long_name: info.user?.longName ?? existing.long_name,
            short_name: info.user?.shortName ?? existing.short_name,
            hw_model: String(info.user?.hwModel ?? existing.hw_model),
            snr: info.snr ?? existing.snr,
            battery: info.deviceMetrics?.batteryLevel ?? existing.battery,
            last_heard: (info.lastHeard ?? 0) > 0
              ? info.lastHeard! * 1000
              : existing.last_heard,
            latitude: newLat,
            longitude: newLon,
            role: info.user?.role ?? existing.role,
            hops_away: info.hopsAway ?? existing.hops_away,
            via_mqtt: info.viaMqtt ?? existing.via_mqtt,
            voltage: info.deviceMetrics?.voltage ?? existing.voltage,
            channel_utilization: info.deviceMetrics?.channelUtilization ?? existing.channel_utilization,
            air_util_tx: info.deviceMetrics?.airUtilTx ?? existing.air_util_tx,
            altitude: newAlt,
            heard_via_mqtt_only: false,
            source: "rf",
            lastPositionWarning: posWarn,
          };
          updated.set(nodeNum, node);
          window.electronAPI.db.saveNode(node);
          return updated;
        });
        const updatedRfNode = nodesRef.current.get(nodeNum);
        if (updatedRfNode) {
          useDiagnosticsStore.getState().processNodeUpdate(
            updatedRfNode,
            nodesRef.current.get(myNodeNumRef.current) ?? null
          );
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
            last_heard: Date.now(),
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
            value?: { batteryLevel?: number; voltage?: number };
          };
        };
        const metrics = tel.deviceMetrics ?? tel.variant?.value;
        if (!metrics) return;

        const point: TelemetryPoint = {
          timestamp: Date.now(),
          batteryLevel: metrics.batteryLevel,
          voltage: metrics.voltage,
        };
        setTelemetry((prev) =>
          [...prev, point].slice(-MAX_TELEMETRY_POINTS)
        );

        // Update node battery if from a known node
        if (metrics.batteryLevel && packet.from) {
          updateNodes((prev) => {
            const updated = new Map(prev);
            const existing = updated.get(packet.from);
            if (existing) {
              updated.set(packet.from, {
                ...existing,
                battery: metrics.batteryLevel!,
                last_heard: Date.now(),
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
              name: ch.settings?.name || (ch.index === 0 ? "Primary" : `Channel ${ch.index}`),
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
            name: ch.settings?.name || "",
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
          rxSnr?: number;
          rxRssi?: number;
          from?: number;
        };
        if (!mp.from) return;

        if (mp.rxSnr || mp.rxRssi) {
          updateNodes((prev) => {
            const updated = new Map(prev);
            const existing = updated.get(mp.from!);
            if (existing) {
              const node: MeshNode = {
                ...existing,
                ...(mp.rxSnr ? { snr: mp.rxSnr } : {}),
                ...(mp.rxRssi ? { rssi: mp.rxRssi } : {}),
                last_heard: Date.now(),
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
            ].slice(-MAX_TELEMETRY_POINTS)
          );
        }
      });
      unsubscribesRef.current.push(unsub9);

      // ─── Mesh heartbeat (built-in liveness signal) ─────────────
      const unsub10 = device.events.onMeshHeartbeat.subscribe(() => {
        touchLastData();
      });
      unsubscribesRef.current.push(unsub10);

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
      if (type === "ble") {
        bleHeartbeatRef.current = setInterval(async () => {
          try {
            await deviceRef.current?.heartbeat();
            touchLastData();
          } catch (err) {
            console.warn("BLE heartbeat write failed:", err);
            // A failed GATT characteristic write = connection is dead
            handleConnectionLostRef.current();
          }
        }, BLE_HEARTBEAT_INTERVAL_MS);
      }

      // ─── Serial heartbeat (existing behavior, keeps device alive)
      if (type === "serial") {
        device.setHeartbeatInterval(60_000);
      }

      // ─── GATT disconnection event (Layer 3) ────────────────────
      if (type === "ble") {
        const btDevice = (device.transport as any)?.__bluetoothDevice;
        if (btDevice) {
          const onGattDisconnected = () => {
            console.warn("GATT server disconnected event fired");
            handleConnectionLostRef.current();
          };
          btDevice.addEventListener("gattserverdisconnected", onGattDisconnected);
          unsubscribesRef.current.push(() => {
            btDevice.removeEventListener("gattserverdisconnected", onGattDisconnected);
          });
        }
      }
    },
    [touchLastData, getNodeName, updateNodes, startPolling, stopPolling,
     startWatchdog, stopWatchdog, stopBleHeartbeat, cleanupSubscriptions]
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
    const oldDevice = deviceRef.current;
    deviceRef.current = null;
    if (oldDevice) safeDisconnect(oldDevice).catch(() => {});

    // Begin reconnection
    attemptReconnectRef.current();
  }, [cleanupSubscriptions, stopPolling, stopWatchdog, stopBleHeartbeat]);

  // Keep the ref in sync
  handleConnectionLostRef.current = handleConnectionLost;

  // ─── Reconnection with exponential backoff ────────────────────
  const attemptReconnect = useCallback(async () => {
    const params = connectionParamsRef.current;
    if (!params) {
      isReconnectingRef.current = false;
      setState((s) => ({ ...s, status: "disconnected", connectionType: null }));
      return;
    }

    if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      isReconnectingRef.current = false;
      reconnectAttemptRef.current = 0;
      setState((s) => ({ ...s, status: "disconnected", connectionType: null }));
      return;
    }

    // Capture the current generation so stale attempts can be detected
    const generation = reconnectGenerationRef.current;

    reconnectAttemptRef.current++;
    setState((s) => ({
      ...s,
      status: "reconnecting",
      reconnectAttempt: reconnectAttemptRef.current,
    }));

    const delay = Math.min(2000 * Math.pow(2, reconnectAttemptRef.current - 1), 32000);
    await new Promise((r) => setTimeout(r, delay));

    // Check if user manually disconnected or started a new connection during the wait
    if (!isReconnectingRef.current || reconnectGenerationRef.current !== generation) return;

    try {
      let device: MeshDevice;
      if (params.type === "ble") {
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
      console.warn(`Reconnect attempt ${reconnectAttemptRef.current} failed:`, err);
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
        safeDisconnect(oldDevice).catch(() => {});
      }

      // Store connection params for reconnection
      connectionParamsRef.current = { type, httpAddress };
      reconnectAttemptRef.current = 0;
      isReconnectingRef.current = false;
      reconnectGenerationRef.current++;

      setState((s) => ({ ...s, status: "connecting", connectionType: type }));

      try {
        const device = await createConnection(type, httpAddress);
        deviceRef.current = device;

        // Wire all event subscriptions
        wireSubscriptions(device, type);

        // Start configuration AFTER all listeners are wired
        device.configure();
      } catch (err) {
        console.error("Connection failed:", err);
        cleanupSubscriptions();
        stopPolling();
        stopWatchdog();
        stopBleHeartbeat();
        deviceRef.current = null;
        setState({
          status: "disconnected",
          myNodeNum: 0,
          connectionType: null,
        });
        throw err;
      }
    },
    [wireSubscriptions, cleanupSubscriptions, stopPolling, stopWatchdog, stopBleHeartbeat]
  );

  const disconnect = useCallback(async () => {
    // Stop all monitoring and reconnection
    cleanupSubscriptions();
    stopPolling();
    stopWatchdog();
    stopBleHeartbeat();
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
    setState({ status: "disconnected", myNodeNum: 0, connectionType: null });
  }, [cleanupSubscriptions, stopPolling, stopWatchdog, stopBleHeartbeat]);

  const sendMessage = useCallback(async (text: string, channel = 0, destination?: number, replyId?: number) => {
    if (!deviceRef.current) {
      if (mqttStatusRef.current !== "connected") throw new Error("Not connected");

      // MQTT-only send path (no device connected)
      const from = myNodeNumRef.current || getOrCreateVirtualNodeId();
      const packetId = await window.electronAPI.mqtt.publish({
        text,
        from,
        channel,
        destination: destination ?? BROADCAST_ADDR,
        channelName: "LongFast",
      });

      const msg: ChatMessage = {
        sender_id: from,
        sender_name: getNodeName(from),
        payload: text,
        channel,
        timestamp: Date.now(),
        packetId,
        status: "acked",
        to: destination,
        replyId,
      };

      // Register packetId to deduplicate the echo that comes back via MQTT subscription
      isDuplicate(packetId);

      setMessages((prev) => [...prev, msg]);
      window.electronAPI.db.saveMessage(msg);
      return;
    }

    try {
      pendingReplyIdRef.current = replyId;
      const dest: number | "broadcast" = destination ?? "broadcast";
      const packetId = await deviceRef.current.sendText(
        text,
        dest,
        true,
        channel
      );
      // ACK received — update message status
      setMessages((prev) =>
        prev.map((m) =>
          m.packetId === packetId ? { ...m, status: "acked" as const } : m
        )
      );
      window.electronAPI.db.updateMessageStatus(packetId, "acked");
    } catch (err) {
      // NAK or timeout — extract packet ID and error from rejection
      const pe = err as any;
      const packetId = pe.packetId;
      const error = pe.error;
      setMessages((prev) =>
        prev.map((m) =>
          m.packetId === packetId ? { ...m, status: "failed", error } : m
        )
      );
      window.electronAPI.db.updateMessageStatus(packetId, "failed", error);
    }
  }, [getNodeName, isDuplicate]);

  const setConfig = useCallback(async (config: unknown) => {
    if (!deviceRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await deviceRef.current.setConfig(config as any);
  }, []);

  const commitConfig = useCallback(async () => {
    if (!deviceRef.current) return;
    await deviceRef.current.commitEditSettings();
  }, []);

  const setDeviceChannel = useCallback(async (args: {
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
  }, []);

  const clearChannel = useCallback(async (index: number) => {
    if (!deviceRef.current) return;
    await deviceRef.current.clearChannel(index);
  }, []);

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

  const deleteNode = useCallback(async (nodeId: number) => {
    await window.electronAPI.db.deleteNode(nodeId);
    updateNodes((prev) => {
      const updated = new Map(prev);
      updated.delete(nodeId);
      return updated;
    });
  }, [updateNodes]);

  const setNodeFavorited = useCallback(async (nodeId: number, favorited: boolean) => {
    await window.electronAPI.db.setNodeFavorited(nodeId, favorited);
    updateNodes((prev) => {
      const updated = new Map(prev);
      const existing = updated.get(nodeId);
      if (existing) updated.set(nodeId, { ...existing, favorited });
      return updated;
    });
  }, [updateNodes]);

  const requestRefresh = useCallback(async () => {
    if (!deviceRef.current) return;
    await deviceRef.current.configure();
  }, []);

  const sendReaction = useCallback(async (emoji: number, replyId: number, channel: number) => {
    if (!deviceRef.current) throw new Error("Not connected");
    await deviceRef.current.sendText("", "broadcast", true, channel, replyId, emoji);
  }, []);

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
    connect,
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
    requestRefresh,
    getFullNodeLabel,
  };
}

// ─── Helper functions ──

// Maps legacy string role labels (stored by older app versions) to numeric IDs
const LEGACY_ROLE_STRINGS: Record<string, number> = {
  "Client": 0, "Mute": 1, "Router": 2, "Rtr+Client": 3,
  "Repeater": 4, "Tracker": 5, "Sensor": 6, "TAK": 7,
  "Hidden": 8, "L&F": 9, "TAK Tracker": 10, "Rtr Late": 11, "Base": 12,
};

function parseNodeRole(val: unknown): number | undefined {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseInt(val, 10);
    if (!isNaN(n)) return n;
    return LEGACY_ROLE_STRINGS[val];
  }
  return undefined;
}

function emptyNode(nodeId: number): MeshNode {
  return {
    node_id: nodeId,
    short_name: "",
    long_name: "",
    hw_model: "",
    snr: 0,
    battery: 0,
    last_heard: 0,
    latitude: 0,
    longitude: 0,
  };
}
