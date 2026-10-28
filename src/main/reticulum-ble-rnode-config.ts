import fs from 'fs';
import path from 'path';

import {
  parseReticulumIniEnabledValue,
  parseReticulumIniInterfaceField,
} from './reticulum-config-ini';
import { readUtf8FileBounded } from './reticulum-config-read';

/** Same set as SERIAL_INTERFACE_TYPES in reticulum-system-instance.ts. */
const SERIAL_LOCAL_RADIO_TYPES = new Set(['rnodeinterface', 'kissinterface', 'ax25kissinterface']);

interface InterfaceBlockFields {
  ifaceType: string | null;
  enabled: boolean | null;
  port: string | null;
}

function isBlePort(port: string): boolean {
  return port.toLowerCase().startsWith('ble://');
}

function blockHasEnabledBleRnode(fields: InterfaceBlockFields): boolean {
  if (!fields.ifaceType || fields.enabled !== true || !fields.port) return false;
  const type = fields.ifaceType.toLowerCase();
  if (type !== 'rnodeinterface' && type !== 'rnode') return false;
  return isBlePort(fields.port);
}

function blockHasEnabledSerialLocalRadio(fields: InterfaceBlockFields): boolean {
  if (!fields.ifaceType || fields.enabled !== true || !fields.port) return false;
  const type = fields.ifaceType.toLowerCase();
  if (!SERIAL_LOCAL_RADIO_TYPES.has(type)) return false;
  return !isBlePort(fields.port);
}

function blockHasEnabledLocalRadio(fields: InterfaceBlockFields): boolean {
  return blockHasEnabledBleRnode(fields) || blockHasEnabledSerialLocalRadio(fields);
}

function scanConfigContent(
  content: string,
  predicate: (fields: InterfaceBlockFields) => boolean,
): boolean {
  let current: InterfaceBlockFields = { ifaceType: null, enabled: null, port: null };

  const flush = (): boolean => {
    const hit = predicate(current);
    current = { ifaceType: null, enabled: null, port: null };
    return hit;
  };

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (line.startsWith('[[') && line.endsWith(']]')) {
      if (flush()) return true;
      continue;
    }
    const parsed = parseReticulumIniInterfaceField(line);
    if (!parsed) continue;
    if (parsed.key === 'type') current.ifaceType = parsed.value;
    if (parsed.key === 'enabled') current.enabled = parseReticulumIniEnabledValue(parsed.value);
    if (parsed.key === 'port') current.port = parsed.value;
  }
  return flush();
}

function readConfigContent(configDir: string): string | null {
  const configPath = path.join(configDir, 'config');
  try {
    if (!fs.existsSync(configPath)) return null;
    return readUtf8FileBounded(configPath);
  } catch {
    // catch-no-log-ok unreadable config treated as no matching interface
    return null;
  }
}

/** True when mesh-client Reticulum config has an enabled BLE RNode interface block. */
export function reticulumConfigDirHasEnabledBleRnode(configDir: string): boolean {
  const content = readConfigContent(configDir);
  if (content == null) return false;
  return scanConfigContent(content, blockHasEnabledBleRnode);
}

/**
 * True when mesh-client Reticulum config has an enabled local radio interface:
 * BLE RNode (`ble://…`) or serial RNode / KISS / AX.25 KISS (non-`ble://` port).
 * Used by the keep-awake `rf` policy while the sidecar is running.
 */
export function reticulumConfigDirHasEnabledLocalRadio(configDir: string): boolean {
  const content = readConfigContent(configDir);
  if (content == null) return false;
  return scanConfigContent(content, blockHasEnabledLocalRadio);
}
