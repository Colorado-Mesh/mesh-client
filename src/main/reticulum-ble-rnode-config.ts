import fs from 'fs';
import path from 'path';

import { readUtf8FileBounded } from './reticulum-config-read';

interface InterfaceBlockFields {
  ifaceType: string | null;
  enabled: boolean | null;
  port: string | null;
}

function parseEnabledValue(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === 'yes' || v === 'true' || v === '1';
}

function parseInterfaceField(line: string): { key: string; value: string } | null {
  const eq = line.indexOf('=');
  if (eq <= 0) return null;
  const key = line.slice(0, eq).trim().toLowerCase();
  let value = line.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function blockHasEnabledBleRnode(fields: InterfaceBlockFields): boolean {
  if (!fields.ifaceType || fields.enabled !== true || !fields.port) return false;
  const type = fields.ifaceType.toLowerCase();
  if (type !== 'rnodeinterface' && type !== 'rnode') return false;
  return fields.port.toLowerCase().startsWith('ble://');
}

function contentHasEnabledBleRnode(content: string): boolean {
  let current: InterfaceBlockFields = { ifaceType: null, enabled: null, port: null };

  const flush = (): boolean => {
    const hit = blockHasEnabledBleRnode(current);
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
    const parsed = parseInterfaceField(line);
    if (!parsed) continue;
    if (parsed.key === 'type') current.ifaceType = parsed.value;
    if (parsed.key === 'enabled') current.enabled = parseEnabledValue(parsed.value);
    if (parsed.key === 'port') current.port = parsed.value;
  }
  return flush();
}

/** True when mesh-client Reticulum config has an enabled BLE RNode interface block. */
export function reticulumConfigDirHasEnabledBleRnode(configDir: string): boolean {
  const configPath = path.join(configDir, 'config');
  try {
    if (!fs.existsSync(configPath)) return false;
    const content = readUtf8FileBounded(configPath);
    return contentHasEnabledBleRnode(content);
  } catch {
    // catch-no-log-ok unreadable config treated as no BLE RNode
    return false;
  }
}
