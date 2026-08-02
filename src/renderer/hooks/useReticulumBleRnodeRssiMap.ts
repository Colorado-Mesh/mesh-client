/* eslint-disable react-hooks/set-state-in-effect -- clear map when inactive; async BLE scan poll updates state */
import { useEffect, useMemo, useState } from 'react';

import { MS_PER_SECOND } from '@/shared/timeConstants';

import { isReticulumBleRnodeInterfaceRow } from '../lib/reticulum/reticulumBleAdapterConflict';
import {
  acquireReticulumBleScan,
  normalizeBleMac,
  parseBleMacFromReticulumSerialPort,
  releaseReticulumBleScan,
} from '../lib/reticulum/reticulumBleAdapterLease';

/** Slow poll — BLE scan is expensive and must not thrash the adapter. */
const RETICULUM_BLE_RSSI_POLL_MS = 15 * MS_PER_SECOND;
const RETICULUM_BLE_RSSI_SCAN_TIMEOUT_SECS = 3;

export interface ReticulumBleRssiInterfaceRow {
  id: string;
  enabled: boolean;
  type: string;
  serial_port?: string | null;
}

function enabledBleRnodeAddresses(interfaces: readonly ReticulumBleRssiInterfaceRow[]): string[] {
  const addrs: string[] = [];
  for (const iface of interfaces) {
    if (!iface.enabled || !isReticulumBleRnodeInterfaceRow(iface)) continue;
    const raw = parseBleMacFromReticulumSerialPort(iface.serial_port ?? '');
    if (!raw) continue;
    addrs.push(normalizeBleMac(raw));
  }
  return addrs;
}

/**
 * Map of normalized BLE address → last scan RSSI for enabled Reticulum BLE RNode rows.
 * Uses sidecar `/api/v1/ble/scan` without disabling interfaces (picker pause is skipped).
 */
export function useReticulumBleRnodeRssiMap(
  interfaces: readonly ReticulumBleRssiInterfaceRow[],
  sidecarReady: boolean,
): ReadonlyMap<string, number> {
  const [rssiByAddress, setRssiByAddress] = useState<ReadonlyMap<string, number>>(() => new Map());

  // Content key only — do not depend on `interfaces` array identity (inline props re-render loop).
  const enabledKey = useMemo(
    () => enabledBleRnodeAddresses(interfaces).slice().sort().join('|'),
    [interfaces],
  );

  useEffect(() => {
    const enabledBleTargets = enabledKey ? enabledKey.split('|') : [];
    if (!sidecarReady || enabledBleTargets.length === 0) {
      setRssiByAddress(new Map());
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let inflight = false;

    const poll = async () => {
      if (cancelled || inflight) return;
      inflight = true;
      let scanAcquired = false;
      try {
        const avail = (await window.electronAPI.reticulum.proxyGet('/api/v1/ble/availability')) as {
          available?: boolean;
        };
        if (!avail.available) return;

        const acquired = await acquireReticulumBleScan();
        if (!acquired) return;
        scanAcquired = true;

        const body = (await window.electronAPI.reticulum.proxyGet(
          `/api/v1/ble/scan?timeout_secs=${RETICULUM_BLE_RSSI_SCAN_TIMEOUT_SECS}&mode=rnode`,
        )) as {
          devices?: { address?: string; rssi?: number | null }[];
          error?: string;
          ok?: boolean;
        };
        if (cancelled || body.error || body.ok === false) return;

        const next = new Map<string, number>();
        for (const device of body.devices ?? []) {
          const addr = typeof device.address === 'string' ? normalizeBleMac(device.address) : '';
          if (!addr) continue;
          if (
            device.rssi != null &&
            Number.isFinite(device.rssi) &&
            enabledBleTargets.includes(addr)
          ) {
            next.set(addr, device.rssi);
          }
        }
        // Preserve previous readings for addresses missing from this scan.
        setRssiByAddress((prev) => {
          const merged = new Map<string, number>();
          for (const addr of enabledBleTargets) {
            if (next.has(addr)) merged.set(addr, next.get(addr)!);
            else if (prev.has(addr)) merged.set(addr, prev.get(addr)!);
          }
          return merged;
        });
      } catch (err) {
        console.debug(
          '[Reticulum] BLE RNode RSSI poll failed:',
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        if (scanAcquired) await releaseReticulumBleScan();
        inflight = false;
      }
    };

    void poll();
    timer = setInterval(() => {
      void poll();
    }, RETICULUM_BLE_RSSI_POLL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [sidecarReady, enabledKey]);

  return rssiByAddress;
}

/** Look up RSSI for a BLE RNode interface row (null when unknown). */
export function rssiForReticulumBleRnodeRow(
  iface: ReticulumBleRssiInterfaceRow,
  rssiByAddress: ReadonlyMap<string, number>,
): number | null {
  if (!iface.enabled || !isReticulumBleRnodeInterfaceRow(iface)) return null;
  const raw = parseBleMacFromReticulumSerialPort(iface.serial_port ?? '');
  if (!raw) return null;
  const rssi = rssiByAddress.get(normalizeBleMac(raw));
  return rssi != null && Number.isFinite(rssi) ? rssi : null;
}
