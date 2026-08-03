/* eslint-disable react-hooks/set-state-in-effect -- clear map when inactive; async BLE scan poll updates state */
import { useEffect, useMemo, useRef, useState } from 'react';

import { RETICULUM_BLE_CONNECT_GRACE_MS } from '@/renderer/lib/reticulum/reticulumLocalInterfaceRefresh';
import { MS_PER_SECOND } from '@/shared/timeConstants';

import { isReticulumBleRnodeInterfaceRow } from '../lib/reticulum/reticulumBleAdapterConflict';
import {
  acquireReticulumBleScan,
  normalizeBleMac,
  parseBleMacFromReticulumSerialPort,
  releaseReticulumBleScan,
} from '../lib/reticulum/reticulumBleAdapterLease';

/** Steady poll — BLE scan is expensive and must not thrash the adapter. */
const RETICULUM_BLE_RSSI_POLL_MS = 15 * MS_PER_SECOND;
/** Burst while waiting for the first sample (aligned with scan timeout). */
const RETICULUM_BLE_RSSI_BURST_POLL_MS = 3 * MS_PER_SECOND;
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

function allTargetsHaveRssi(
  targets: readonly string[],
  rssiByAddress: ReadonlyMap<string, number>,
): boolean {
  return targets.every((addr) => rssiByAddress.has(addr));
}

function hasBleRnodeRows(interfaces: readonly ReticulumBleRssiInterfaceRow[]): boolean {
  return interfaces.some((iface) => isReticulumBleRnodeInterfaceRow(iface));
}

/**
 * Map of normalized BLE address → last scan RSSI for enabled Reticulum BLE RNode rows.
 * Uses sidecar `/api/v1/ble/scan` without disabling interfaces (picker pause is skipped).
 *
 * Gate on sidecar **running** (not `sidecarApiReady`) so the first-start advertising
 * window can seed a reading before GATT connect stops adverts. Bursts until each
 * target has a sample (or grace expires), then steadies at 15s. Empty scans preserve
 * the last good reading.
 */
export function useReticulumBleRnodeRssiMap(
  interfaces: readonly ReticulumBleRssiInterfaceRow[],
  sidecarRunning: boolean,
): ReadonlyMap<string, number> {
  const [rssiByAddress, setRssiByAddress] = useState<ReadonlyMap<string, number>>(() => new Map());
  // Updated only in the poll path (not during render) for burst vs steady scheduling.
  const rssiByAddressRef = useRef<ReadonlyMap<string, number>>(rssiByAddress);

  // Sticky last non-empty target set so a brief empty hydrate does not clear/stop polls
  // while the sidecar is still running. Expires after BLE connect grace if still empty.
  const stickyTargetsRef = useRef<string[]>([]);
  const stickyIdleExpiresAtRef = useRef(0);

  // Content key only — do not depend on `interfaces` array identity (inline props re-render loop).
  const enabledKey = useMemo(
    () => enabledBleRnodeAddresses(interfaces).slice().sort().join('|'),
    [interfaces],
  );
  const hasAnyBleRnodeKey = useMemo(() => (hasBleRnodeRows(interfaces) ? '1' : '0'), [interfaces]);

  useEffect(() => {
    if (!sidecarRunning) {
      stickyTargetsRef.current = [];
      stickyIdleExpiresAtRef.current = 0;
      rssiByAddressRef.current = new Map();
      setRssiByAddress(new Map());
      return;
    }

    const fromInterfaces = enabledKey ? enabledKey.split('|') : [];
    if (fromInterfaces.length > 0) {
      stickyTargetsRef.current = fromInterfaces;
      // Targets present — cancel any idle expiry (brief empty hydrate can restart it).
      stickyIdleExpiresAtRef.current = 0;
    } else if (stickyTargetsRef.current.length > 0) {
      // User disabled all BLE RNodes (rows still present) — stop scanning immediately.
      // Brief empty hydrate (no BLE rows in list) keeps sticky targets through grace.
      if (hasAnyBleRnodeKey === '1') {
        stickyTargetsRef.current = [];
        stickyIdleExpiresAtRef.current = 0;
        rssiByAddressRef.current = new Map();
        setRssiByAddress(new Map());
        return;
      }
      if (stickyIdleExpiresAtRef.current === 0) {
        stickyIdleExpiresAtRef.current = Date.now() + RETICULUM_BLE_CONNECT_GRACE_MS;
      }
      const remainingMs = stickyIdleExpiresAtRef.current - Date.now();
      if (remainingMs <= 0) {
        stickyTargetsRef.current = [];
        stickyIdleExpiresAtRef.current = 0;
        rssiByAddressRef.current = new Map();
        setRssiByAddress(new Map());
        return;
      }
    }

    const enabledBleTargets = stickyTargetsRef.current;
    if (enabledBleTargets.length === 0) {
      // Sidecar running but no BLE RNode targets yet — keep any prior map; do not clear.
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let idleClearTimer: ReturnType<typeof setTimeout> | null = null;
    let inflight = false;
    const burstStartedAt = Date.now();

    if (fromInterfaces.length === 0 && stickyIdleExpiresAtRef.current > Date.now()) {
      idleClearTimer = setTimeout(() => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        stickyTargetsRef.current = [];
        stickyIdleExpiresAtRef.current = 0;
        rssiByAddressRef.current = new Map();
        setRssiByAddress(new Map());
      }, stickyIdleExpiresAtRef.current - Date.now());
    }

    const scheduleNext = () => {
      if (cancelled) return;
      const haveAll = allTargetsHaveRssi(enabledBleTargets, rssiByAddressRef.current);
      const withinGrace = Date.now() - burstStartedAt < RETICULUM_BLE_CONNECT_GRACE_MS;
      const delay =
        !haveAll && withinGrace ? RETICULUM_BLE_RSSI_BURST_POLL_MS : RETICULUM_BLE_RSSI_POLL_MS;
      timer = setTimeout(() => {
        void poll();
      }, delay);
    };

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
        const prev = rssiByAddressRef.current;
        const merged = new Map<string, number>();
        for (const addr of enabledBleTargets) {
          if (next.has(addr)) merged.set(addr, next.get(addr)!);
          else if (prev.has(addr)) merged.set(addr, prev.get(addr)!);
        }
        rssiByAddressRef.current = merged;
        setRssiByAddress(merged);
      } catch (err) {
        console.debug(
          '[Reticulum] BLE RNode RSSI poll failed:',
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        if (scanAcquired) await releaseReticulumBleScan();
        inflight = false;
        if (!cancelled) scheduleNext();
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (idleClearTimer) clearTimeout(idleClearTimer);
    };
  }, [sidecarRunning, enabledKey, hasAnyBleRnodeKey]);

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
