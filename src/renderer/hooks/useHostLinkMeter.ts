/* eslint-disable react-hooks/set-state-in-effect -- clear meter when inactive; async GATT/RTT probes update state */
import { useEffect, useState } from 'react';

import {
  type ConnectionLinkMeterKind,
  HOST_LINK_QUALITY_POLL_MS,
  isLiveTcpSession,
  probeHttpLinkRttMs,
  probeSessionMeter,
  rttToSignalLevel,
  type SignalBarLevel,
} from '../lib/hostLinkQuality';
import type { ConnectionStatus, ConnectionType, MeshProtocol } from '../lib/types';

export interface HostLinkMeterState {
  kind: ConnectionLinkMeterKind | null;
  rssi: number | null;
  rttMs: number | null;
  level: SignalBarLevel | null;
}

const IDLE: HostLinkMeterState = {
  kind: null,
  rssi: null,
  rttMs: null,
  level: null,
};

function isConnectedStatus(status: ConnectionStatus): boolean {
  return (
    status === 'connected' ||
    status === 'configured' ||
    status === 'stale' ||
    status === 'reconnecting'
  );
}

/** Electron GATT session id for LoRa BLE host-link RSSI (not Reticulum). */
function gattBleRssiSessionId(
  protocol: MeshProtocol,
): 'meshtastic' | 'meshcore' | 'meshcom' | null {
  if (protocol === 'meshtastic' || protocol === 'meshcore' || protocol === 'meshcom') {
    return protocol;
  }
  return null;
}

/**
 * Host↔radio link meter state for Meshtastic / MeshCore / MeshCom Connection panels.
 * BLE (all platforms): sidecar GATT link RSSI.
 * Live TCP sessions: passive session meter. Meshtastic HTTP: `/json/report` RTT.
 */
export function useHostLinkMeter(opts: {
  protocol: MeshProtocol;
  connectionType: ConnectionType | null;
  status: ConnectionStatus;
  /** Active HTTP/TCP address (panel local state or last connection). */
  hostAddress: string | null | undefined;
  platform: NodeJS.Platform | null;
  /**
   * Last scan-time RSSI for the connected peripheral (CoreBluetooth often has no
   * live RSSI after connect — seed the meter until GATT emits).
   */
  bleSeedRssi?: number | null;
}): HostLinkMeterState {
  const { protocol, connectionType, status, hostAddress, bleSeedRssi } = opts;
  const [rssi, setRssi] = useState<number | null>(null);
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [gattRssiSeen, setGattRssiSeen] = useState(false);

  const active =
    protocol !== 'reticulum' &&
    (isConnectedStatus(status) ||
      // DeviceConfiguring maps to connecting — still show BLE host RSSI while NodeDB dumps.
      (status === 'connecting' && connectionType === 'ble')) &&
    (connectionType === 'ble' || connectionType === 'http' || connectionType === 'tcp');

  const liveTcp = isLiveTcpSession(protocol, connectionType);
  const meshtasticHttp = protocol === 'meshtastic' && connectionType === 'http';

  // BLE RSSI via sidecar GATT
  useEffect(() => {
    if (!active || connectionType !== 'ble') {
      setRssi(null);
      setGattRssiSeen(false);
      return;
    }
    const sessionId = gattBleRssiSessionId(protocol);
    if (!sessionId) {
      setRssi(null);
      setGattRssiSeen(false);
      return;
    }
    setGattRssiSeen(false);
    if (bleSeedRssi != null && Number.isFinite(bleSeedRssi)) {
      setRssi(bleSeedRssi);
    }
    const unsub = window.electronAPI.onGattLinkRssi((payload) => {
      if (payload.sessionId !== sessionId) return;
      setGattRssiSeen(true);
      setRssi(payload.rssi != null && Number.isFinite(payload.rssi) ? payload.rssi : null);
    });
    return () => {
      unsub();
      setRssi(null);
      setGattRssiSeen(false);
    };
  }, [active, bleSeedRssi, connectionType, protocol, status]);

  // HTTP probe or live-TCP session meter
  useEffect(() => {
    if (!active || (!liveTcp && !meshtasticHttp)) {
      setRttMs(null);
      return;
    }
    const httpAddress = hostAddress?.trim() ?? '';
    if (meshtasticHttp && !httpAddress) {
      setRttMs(null);
      return;
    }

    let cancelled = false;
    let probeGeneration = 0;
    let timer: ReturnType<typeof setInterval> | null = null;

    const run = async () => {
      probeGeneration += 1;
      const generation = probeGeneration;
      let next: number | null = null;
      if (liveTcp && (protocol === 'meshtastic' || protocol === 'meshcore')) {
        next = await probeSessionMeter(protocol);
      } else if (meshtasticHttp) {
        next = await probeHttpLinkRttMs(httpAddress);
      }
      if (!cancelled && generation === probeGeneration) setRttMs(next);
    };

    // Clear immediately on transport switch so a prior HTTP RTT cannot flash as TCP quality.
    setRttMs(null);
    void run();
    timer = setInterval(() => {
      void run();
    }, HOST_LINK_QUALITY_POLL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      setRttMs(null);
    };
  }, [active, hostAddress, liveTcp, meshtasticHttp, protocol]);

  if (!active || !connectionType) return IDLE;

  if (connectionType === 'ble') {
    const displayRssi =
      rssi ??
      (!gattRssiSeen && bleSeedRssi != null && Number.isFinite(bleSeedRssi) ? bleSeedRssi : null);
    return { kind: 'ble-rssi', rssi: displayRssi, rttMs: null, level: null };
  }

  if (connectionType === 'http' || connectionType === 'tcp') {
    const level = rttMs != null ? rttToSignalLevel(rttMs) : null;
    return { kind: 'ip-rtt', rssi: null, rttMs, level };
  }

  return IDLE;
}
