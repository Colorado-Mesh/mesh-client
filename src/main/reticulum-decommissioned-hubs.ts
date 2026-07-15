import fs from 'fs';
import path from 'path';

import { isDecommissionedReticulumTcpHub } from '../shared/reticulumDecommissionedHubs';
import { readUtf8FileBounded } from './reticulum-config-read';

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

interface TcpBlockState {
  name: string;
  startLine: number;
  endLine: number;
  ifaceType: string | null;
  enabled: boolean | null;
  host: string | null;
  port: number | null;
}

/**
 * Disable enabled TCPClientInterface blocks pointed at decommissioned testnet hubs.
 * Returns names of interfaces that were disabled (empty when nothing changed).
 */
export function disableDecommissionedReticulumHubsInConfigContent(content: string): {
  next: string;
  disabledNames: string[];
} {
  const lines = content.split('\n');
  const blocks: TcpBlockState[] = [];
  let current: TcpBlockState | null = null;

  const flush = (): void => {
    if (!current) return;
    blocks.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (line.startsWith('[[') && line.endsWith(']]')) {
      flush();
      current = {
        name: line.slice(2, -2).trim(),
        startLine: i,
        endLine: i,
        ifaceType: null,
        enabled: null,
        host: null,
        port: null,
      };
      continue;
    }
    if (!current) continue;
    current.endLine = i;
    const parsed = parseInterfaceField(line);
    if (!parsed) continue;
    if (parsed.key === 'type') current.ifaceType = parsed.value;
    if (parsed.key === 'name' && parsed.value.trim()) current.name = parsed.value.trim();
    if (parsed.key === 'enabled' || parsed.key === 'interface_enabled') {
      current.enabled = parseEnabledValue(parsed.value);
    }
    if (parsed.key === 'target_host') current.host = parsed.value;
    if (parsed.key === 'target_port') {
      const port = Number.parseInt(parsed.value, 10);
      current.port = Number.isFinite(port) ? port : null;
    }
  }
  flush();

  const disabledNames: string[] = [];
  const out = [...lines];

  for (const block of blocks) {
    const typeNorm = (block.ifaceType ?? '').toLowerCase();
    const typeOk = typeNorm === 'tcpclientinterface' || typeNorm === 'tcp';
    if (!typeOk || block.enabled !== true || !block.host || block.port == null) continue;
    if (!isDecommissionedReticulumTcpHub(block.host, block.port)) continue;

    disabledNames.push(block.name);
    for (let i = block.startLine; i <= block.endLine; i++) {
      const line = out[i] ?? '';
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
      const parsed = parseInterfaceField(trimmed);
      if (!parsed) continue;
      if (parsed.key !== 'interface_enabled' && parsed.key !== 'enabled') continue;
      const indent = line.slice(0, line.length - line.trimStart().length);
      const key = parsed.key === 'enabled' ? 'enabled' : 'interface_enabled';
      out[i] = `${indent}${key} = No`;
    }
  }

  return { next: out.join('\n'), disabledNames };
}

/** Patch mesh-client reticulum config on disk before sidecar start. */
export function disableDecommissionedReticulumHubsInConfigDir(configDir: string): string[] {
  const configPath = path.join(configDir, 'config');
  try {
    if (!fs.existsSync(configPath)) return [];
    const content = readUtf8FileBounded(configPath);
    const { next, disabledNames } = disableDecommissionedReticulumHubsInConfigContent(content);
    if (disabledNames.length === 0 || next === content) return [];
    fs.writeFileSync(configPath, next, 'utf8');
    return disabledNames;
  } catch (err) {
    console.warn(
      '[reticulum-decommissioned-hubs] failed to disable decommissioned hubs:',
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}
