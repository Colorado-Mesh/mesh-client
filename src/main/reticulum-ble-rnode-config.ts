import fs from 'fs';
import path from 'path';

import {
  parseReticulumIniEnabledValue,
  parseReticulumIniInterfaceField,
} from './reticulum-config-ini';
import { readUtf8FileBounded } from './reticulum-config-read';

/**
 * Local radios that should hold the machine awake. RNodeMultiInterface is the
 * sidecar's multi-port RNode; TCP RNodes (`tcp://`) stay network-only.
 */
const SERIAL_LOCAL_RADIO_TYPES = new Set([
  'rnodeinterface',
  'rnodemultiinterface',
  'kissinterface',
  'ax25kissinterface',
]);

const RNODE_TYPES = new Set(['rnodeinterface', 'rnode', 'rnodemultiinterface']);

interface InterfaceBlockFields {
  ifaceType: string | null;
  enabled: boolean | null;
  /** Set once `enabled` is seen so it wins over a later `interface_enabled` (sidecar order). */
  enabledKeySeen: boolean;
  port: string | null;
}

function isBlePort(port: string): boolean {
  return port.toLowerCase().startsWith('ble://');
}

/** RNode-over-IP uses `tcp://host[:7633]` — network, not local serial. */
function isTcpRnodePort(port: string): boolean {
  return port.toLowerCase().startsWith('tcp://');
}

function blockHasEnabledBleRnode(fields: InterfaceBlockFields): boolean {
  if (!fields.ifaceType || fields.enabled !== true || !fields.port) return false;
  const type = fields.ifaceType.toLowerCase();
  if (!RNODE_TYPES.has(type)) return false;
  return isBlePort(fields.port);
}

function blockHasEnabledSerialLocalRadio(fields: InterfaceBlockFields): boolean {
  if (!fields.ifaceType || fields.enabled !== true || !fields.port) return false;
  const type = fields.ifaceType.toLowerCase();
  if (!SERIAL_LOCAL_RADIO_TYPES.has(type)) return false;
  return !isBlePort(fields.port) && !isTcpRnodePort(fields.port);
}

function blockHasEnabledLocalRadio(fields: InterfaceBlockFields): boolean {
  return blockHasEnabledBleRnode(fields) || blockHasEnabledSerialLocalRadio(fields);
}

/** Drop `#` comments that are outside double quotes (same rule as the sidecar parser). */
function stripInlineComment(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '#' && !inQuote) return line.slice(0, i);
  }
  return line;
}

function isSectionHeader(line: string): boolean {
  return line.startsWith('[') && line.endsWith(']');
}

function scanConfigContent(
  content: string,
  predicate: (fields: InterfaceBlockFields) => boolean,
): boolean {
  let current: InterfaceBlockFields = {
    ifaceType: null,
    enabled: null,
    enabledKeySeen: false,
    port: null,
  };

  const flush = (): boolean => {
    const hit = predicate(current);
    current = { ifaceType: null, enabled: null, enabledKeySeen: false, port: null };
    return hit;
  };

  for (const rawLine of content.split('\n')) {
    const line = stripInlineComment(rawLine).trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    // Any `[section]` / `[[interface]]` ends the previous block so a later
    // `[logging]` (or other trailing section) cannot overwrite type/enabled/port.
    if (isSectionHeader(line)) {
      if (flush()) return true;
      continue;
    }
    const parsed = parseReticulumIniInterfaceField(line);
    if (!parsed) continue;
    if (parsed.key === 'type') current.ifaceType = parsed.value;
    // Sidecar: `enabled` if present, otherwise `interface_enabled`.
    if (parsed.key === 'enabled') {
      current.enabled = parseReticulumIniEnabledValue(parsed.value);
      current.enabledKeySeen = true;
    } else if (parsed.key === 'interface_enabled' && !current.enabledKeySeen) {
      current.enabled = parseReticulumIniEnabledValue(parsed.value);
    }
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
 * BLE RNode (`ble://…`) or serial RNode / KISS / AX.25 KISS (device path, not
 * `ble://` or `tcp://` Wi-Fi RNode). Used by the keep-awake `rf` policy while
 * the sidecar is running.
 */
export function reticulumConfigDirHasEnabledLocalRadio(configDir: string): boolean {
  const content = readConfigContent(configDir);
  if (content == null) return false;
  return scanConfigContent(content, blockHasEnabledLocalRadio);
}
