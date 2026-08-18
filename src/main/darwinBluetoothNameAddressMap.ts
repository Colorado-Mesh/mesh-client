import { spawn } from 'child_process';

import { isTwelveHexBleMac, normalizeBleMac } from '../shared/normalizeBleMac';
import { MS_PER_SECOND } from '../shared/timeConstants';

/** Bound `system_profiler SPBluetoothDataType -json` so scan start cannot hang IPC. */
export const DARWIN_BT_PROFILER_TIMEOUT_MS = 5 * MS_PER_SECOND;

type NameToMacSets = Map<string, Set<string>>;

function addNamedAddress(acc: NameToMacSets, name: string, address: string): void {
  const trimmedName = name.trim();
  if (!trimmedName || !isTwelveHexBleMac(address)) return;
  const mac = normalizeBleMac(address);
  const existing = acc.get(trimmedName);
  if (existing) {
    existing.add(mac);
    return;
  }
  acc.set(trimmedName, new Set([mac]));
}

function collectNamedDevices(list: unknown, acc: NameToMacSets): void {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    for (const [name, info] of Object.entries(item as Record<string, unknown>)) {
      if (!info || typeof info !== 'object') continue;
      const address = (info as { device_address?: unknown }).device_address;
      if (typeof address !== 'string') continue;
      addNamedAddress(acc, name, address);
    }
  }
}

/**
 * Unique advertised-name → BLE MAC from `system_profiler SPBluetoothDataType -json`.
 * Names that map to more than one MAC are omitted (ambiguous).
 */
export function parseDarwinBluetoothNameAddressMap(raw: unknown): Map<string, string> {
  const acc: NameToMacSets = new Map();
  if (!raw || typeof raw !== 'object') return new Map();
  const blocks = (raw as { SPBluetoothDataType?: unknown }).SPBluetoothDataType;
  if (!Array.isArray(blocks)) return new Map();
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const rec = block as { device_connected?: unknown; device_not_connected?: unknown };
    collectNamedDevices(rec.device_connected, acc);
    collectNamedDevices(rec.device_not_connected, acc);
  }
  const unique = new Map<string, string>();
  for (const [name, macs] of acc) {
    if (macs.size !== 1) continue;
    const mac = [...macs][0];
    if (mac) unique.set(name, mac);
  }
  return unique;
}

/**
 * Prefer Noble's OS-exposed MAC (linux/win32). On modern macOS that field is empty, so
 * fall back to a unique GAP-name → MAC map from system_profiler.
 */
export function resolveDarwinScanAddress(
  nobleAddress: string | undefined,
  localName: string | undefined,
  nameToMac: ReadonlyMap<string, string>,
): string | undefined {
  const trimmed = nobleAddress?.trim();
  if (trimmed && trimmed.toLowerCase() !== 'unknown') {
    return trimmed;
  }
  const name = localName?.trim();
  if (!name) return undefined;
  const exact = nameToMac.get(name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  let match: string | undefined;
  for (const [mappedName, mac] of nameToMac) {
    if (mappedName.toLowerCase() !== lower) continue;
    if (match && match !== mac) return undefined;
    match = mac;
  }
  return match;
}

export async function readSystemProfilerBluetoothJson(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // OS-specific: absolute path so packaged Electron still finds the binary.
    const proc = spawn('/usr/sbin/system_profiler', ['SPBluetoothDataType', '-json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      proc.kill();
      finish(() => {
        reject(
          new Error(
            `system_profiler SPBluetoothDataType timed out after ${DARWIN_BT_PROFILER_TIMEOUT_MS}ms`,
          ),
        );
      });
    }, DARWIN_BT_PROFILER_TIMEOUT_MS);
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    proc.on('error', (err) => {
      finish(() => {
        reject(err);
      });
    });
    proc.on('close', (code) => {
      finish(() => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(new Error(`system_profiler SPBluetoothDataType exited ${code}: ${stderr.trim()}`));
      });
    });
  });
}

/** Load unique GAP-name → MAC map for darwin Noble scans (Noble `peripheral.address` is empty). */
export async function loadDarwinBluetoothNameAddressMap(
  readJson: () => Promise<string> = readSystemProfilerBluetoothJson,
): Promise<Map<string, string>> {
  const rawText = await readJson();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    throw new Error('system_profiler SPBluetoothDataType returned invalid JSON');
  }
  return parseDarwinBluetoothNameAddressMap(parsed);
}
