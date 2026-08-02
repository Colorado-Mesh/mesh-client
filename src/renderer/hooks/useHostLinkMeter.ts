/* eslint-disable react-hooks/set-state-in-effect -- clear meter when inactive; async Noble/RTT probes update state */
import { useEffect, useState } from 'react';

import {
  type ConnectionLinkMeterKind,
  HOST_LINK_QUALITY_POLL_MS,
  probeHttpLinkRttMs,
  probeTcpLinkRttMs,
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

/**
 * Host↔radio link meter state for Meshtastic / MeshCore Connection panels.
 * BLE (darwin/win32): Noble link RSSI. BLE (linux): unavailable. HTTP/TCP: RTT probe.
 */
export function useHostLinkMeter(opts: {
  protocol: MeshProtocol;
  connectionType: ConnectionType | null;
  status: ConnectionStatus;
  /** Active HTTP/TCP address (panel local state or last connection). */
  hostAddress: string | null | undefined;
  platform: NodeJS.Platform | null;
}): HostLinkMeterState {
  const { protocol, connectionType, status, hostAddress, platform } = opts;
  const [rssi, setRssi] = useState<number | null>(null);
  const [rttMs, setRttMs] = useState<number | null>(null);

  const active =
    protocol !== 'reticulum' &&
    isConnectedStatus(status) &&
    (connectionType === 'ble' || connectionType === 'http' || connectionType === 'tcp');

  // BLE RSSI via Noble (macOS / Windows)
  useEffect(() => {
    if (!active || connectionType !== 'ble') {
      setRssi(null);
      return;
    }
    if (platform === 'linux') {
      setRssi(null);
      return;
    }
    const sessionId = protocol === 'meshcore' ? 'meshcore' : 'meshtastic';
    const unsub = window.electronAPI.onNobleBleLinkRssi((payload) => {
      if (payload.sessionId !== sessionId) return;
      setRssi(payload.rssi != null && Number.isFinite(payload.rssi) ? payload.rssi : null);
    });
    return () => {
      unsub();
      setRssi(null);
    };
  }, [active, connectionType, platform, protocol]);

  // HTTP / TCP RTT probe
  useEffect(() => {
    if (!active || (connectionType !== 'http' && connectionType !== 'tcp')) {
      setRttMs(null);
      return;
    }
    const address = hostAddress?.trim();
    if (!address) {
      setRttMs(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const run = async () => {
      let next: number | null = null;
      if (protocol === 'meshtastic' && connectionType === 'http') {
        next = await probeHttpLinkRttMs(address);
      } else if (protocol === 'meshtastic' && connectionType === 'tcp') {
        next = await probeTcpLinkRttMs(address, 'meshtastic');
      } else if (protocol === 'meshcore' && connectionType === 'http') {
        // MeshCore "http" transport is TCP/IP host:port
        next = await probeTcpLinkRttMs(address, 'meshcore');
      }
      if (!cancelled) setRttMs(next);
    };

    void run();
    timer = setInterval(() => {
      void run();
    }, HOST_LINK_QUALITY_POLL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      setRttMs(null);
    };
  }, [active, connectionType, hostAddress, protocol]);

  if (!active || !connectionType) return IDLE;

  if (connectionType === 'ble') {
    if (platform === 'linux') {
      return { kind: 'unavailable', rssi: null, rttMs: null, level: null };
    }
    return { kind: 'ble-rssi', rssi, rttMs: null, level: null };
  }

  if (connectionType === 'http' || connectionType === 'tcp') {
    const level = rttMs != null ? rttToSignalLevel(rttMs) : null;
    return { kind: 'ip-rtt', rssi: null, rttMs, level };
  }

  return IDLE;
}
