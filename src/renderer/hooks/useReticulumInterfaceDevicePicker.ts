import { useCallback, useState } from 'react';

import {
  acquireReticulumBleAdapter,
  isMeshBleConnected,
  isReticulumBleInterfaceRow,
  releaseReticulumBleAdapter,
} from '@/renderer/lib/reticulum/reticulumBleAdapterConflict';
import {
  fetchReticulumInterfaces,
  fetchReticulumSerialPorts,
  invalidateReticulumInterfacesCache,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';

export type ReticulumDevicePickerMode = 'serial' | 'ble-peer' | 'ble-rnode';

export interface ReticulumPickerDevice {
  address: string;
  name?: string;
  rssi?: number;
  kind?: string;
}

export interface ReticulumDevicePickerRequest {
  mode: ReticulumDevicePickerMode;
  sidecarReady: boolean;
  onSelect: (value: string) => void;
}

const BLE_SCAN_INTERFACE_SETTLE_MS = 400;
/** After Noble teardown, allow CoreBluetooth/btleplug to settle before scanning. */
const BLE_ADAPTER_SETTLE_MS = 500;

async function pauseEnabledReticulumBleInterfaces(): Promise<string[]> {
  invalidateReticulumInterfacesCache();
  const interfaces = await fetchReticulumInterfaces();
  const paused: string[] = [];
  for (const row of interfaces) {
    if (!row.enabled || !isReticulumBleInterfaceRow(row)) continue;
    const res = (await window.electronAPI.reticulum.proxyPost(
      `/api/v1/interfaces/${row.id}/disable`,
      {},
    )) as { ok?: boolean };
    if (res?.ok !== false) {
      paused.push(row.id);
    }
  }
  if (paused.length > 0) {
    invalidateReticulumInterfacesCache();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, BLE_SCAN_INTERFACE_SETTLE_MS);
    });
  }
  return paused;
}

async function resumeReticulumBleInterfaces(ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    try {
      await window.electronAPI.reticulum.proxyPost(`/api/v1/interfaces/${id}/enable`, {});
    } catch (err) {
      console.warn('[Reticulum] failed to re-enable BLE interface after scan:', err);
    }
  }
  if (ids.length > 0) {
    invalidateReticulumInterfacesCache();
  }
}

function scanModeForPicker(mode: ReticulumDevicePickerMode): 'peer' | 'rnode' | 'all' {
  if (mode === 'ble-peer') return 'peer';
  if (mode === 'ble-rnode') return 'rnode';
  return 'all';
}

export function useReticulumInterfaceDevicePicker() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ReticulumDevicePickerMode>('serial');
  const [devices, setDevices] = useState<ReticulumPickerDevice[]>([]);
  const [serialPorts, setSerialPorts] = useState<{ path: string; label?: string }[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [manualPath, setManualPath] = useState('');
  const [onSelectRef, setOnSelectRef] = useState<((value: string) => void) | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setScanning(false);
    setScanError(null);
    setOnSelectRef(null);
    void releaseReticulumBleAdapter();
  }, []);

  const refreshSerial = useCallback(async () => {
    const ports = await fetchReticulumSerialPorts();
    setSerialPorts(ports.map((path) => ({ path })));
  }, []);

  const runBleScan = useCallback(async (pickerMode: ReticulumDevicePickerMode) => {
    setScanning(true);
    setScanError(null);
    setDevices([]);
    let pausedInterfaceIds: string[] = [];
    let adapterAcquired = false;
    const scanMode = scanModeForPicker(pickerMode);
    try {
      if (isMeshBleConnected()) {
        setScanError('mesh_ble_active');
        return;
      }

      pausedInterfaceIds = await pauseEnabledReticulumBleInterfaces();

      const avail = (await window.electronAPI.reticulum.proxyGet('/api/v1/ble/availability')) as {
        available?: boolean;
        missing?: string[];
      };
      if (!avail.available) {
        const reason = avail.missing?.[0];
        setScanError(reason?.length ? reason : 'ble_unavailable');
        return;
      }

      const acquired = await acquireReticulumBleAdapter();
      if (!acquired) {
        setScanError('adapter_busy');
        return;
      }
      adapterAcquired = true;

      await new Promise<void>((resolve) => {
        setTimeout(resolve, BLE_ADAPTER_SETTLE_MS);
      });

      const body = (await window.electronAPI.reticulum.proxyGet(
        `/api/v1/ble/scan?timeout_secs=8&mode=${scanMode}`,
      )) as { devices?: ReticulumPickerDevice[]; error?: string; ok?: boolean };
      if (body.error || body.ok === false) {
        setScanError(body.error ?? 'scan_failed');
        return;
      }
      setDevices(body.devices ?? []);
    } catch (err) {
      console.warn('[Reticulum] BLE scan failed:', err);
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      await resumeReticulumBleInterfaces(pausedInterfaceIds);
      if (adapterAcquired) {
        await releaseReticulumBleAdapter();
      }
      setScanning(false);
    }
  }, []);

  const openPicker = useCallback(
    async (request: ReticulumDevicePickerRequest) => {
      setMode(request.mode);
      setOnSelectRef(() => request.onSelect);
      setManualPath('');
      setScanError(null);
      setOpen(true);

      if (request.mode === 'serial') {
        if (!request.sidecarReady) {
          setScanError('stack_required');
          setSerialPorts([]);
          return;
        }
        await refreshSerial();
        return;
      }

      if (!request.sidecarReady) {
        setScanError('stack_required');
        return;
      }

      await runBleScan(request.mode);
    },
    [refreshSerial, runBleScan],
  );

  const selectDevice = useCallback(
    (value: string) => {
      onSelectRef?.(value);
      close();
    },
    [close, onSelectRef],
  );

  return {
    open,
    mode,
    devices,
    serialPorts,
    scanning,
    scanError,
    manualPath,
    setManualPath,
    openPicker,
    close,
    selectDevice,
    refreshSerial,
    rescanBle: () => {
      void runBleScan(mode);
    },
  };
}
