import fs from 'fs';

import { joinUnderRoot } from '../shared/pathUnderRoot';
import { isDecommissionedReticulumTcpHub } from '../shared/reticulumDecommissionedHubs';
import {
  parseReticulumIniEnabledValue,
  parseReticulumIniInterfaceField,
} from './reticulum-config-ini';
import { readUtf8FileBounded } from './reticulum-config-read';
import { sanitizeLogMessage } from './sanitize-log-message';

interface TcpBlockState {
  name: string;
  startLine: number;
  endLine: number;
  ifaceType: string | null;
  enabled: boolean | null;
  host: string | null;
  port: number | null;
}

function applyReticulumTcpBlockField(
  block: TcpBlockState,
  parsed: NonNullable<ReturnType<typeof parseReticulumIniInterfaceField>>,
): void {
  if (parsed.key === 'type') block.ifaceType = parsed.value;
  if (parsed.key === 'name' && parsed.value.trim()) block.name = parsed.value.trim();
  if (parsed.key === 'enabled' || parsed.key === 'interface_enabled') {
    block.enabled = parseReticulumIniEnabledValue(parsed.value);
  }
  if (parsed.key === 'target_host') block.host = parsed.value;
  if (parsed.key === 'target_port') {
    const port = Number.parseInt(parsed.value, 10);
    block.port = Number.isFinite(port) ? port : null;
  }
}

/** Collects `[[Interface]]` blocks with their TCP fields and line span. */
function parseReticulumTcpBlocks(lines: string[]): TcpBlockState[] {
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
    const parsed = parseReticulumIniInterfaceField(line);
    if (parsed) applyReticulumTcpBlockField(current, parsed);
  }
  flush();
  return blocks;
}

/** Rewrites the block's `enabled` / `interface_enabled` lines to `No`. */
function rewriteReticulumTcpBlockEnabledLines(out: string[], block: TcpBlockState): void {
  for (let i = block.startLine; i <= block.endLine; i++) {
    const line = out[i] ?? '';
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const parsed = parseReticulumIniInterfaceField(trimmed);
    if (!parsed) continue;
    if (parsed.key !== 'interface_enabled' && parsed.key !== 'enabled') continue;
    const indent = line.slice(0, line.length - line.trimStart().length);
    const key = parsed.key === 'enabled' ? 'enabled' : 'interface_enabled';
    out[i] = `${indent}${key} = No`;
  }
}

/** True when the block is an enabled TCP client pointed at a decommissioned hub. */
function isDecommissionedTcpClientBlock(block: TcpBlockState): boolean {
  const typeNorm = (block.ifaceType ?? '').toLowerCase();
  const typeOk = typeNorm === 'tcpclientinterface' || typeNorm === 'tcp';
  if (!typeOk || block.enabled !== true || !block.host || block.port == null) return false;
  return isDecommissionedReticulumTcpHub(block.host, block.port);
}

/** Rewrites `enabled` lines for a decommissioned hub block; true when it was disabled. */
function disableReticulumTcpBlock(out: string[], block: TcpBlockState): boolean {
  if (!isDecommissionedTcpClientBlock(block)) return false;
  rewriteReticulumTcpBlockEnabledLines(out, block);
  return true;
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
  const out = [...lines];
  const disabledNames: string[] = [];
  for (const block of parseReticulumTcpBlocks(lines)) {
    if (disableReticulumTcpBlock(out, block)) disabledNames.push(block.name);
  }
  return { next: out.join('\n'), disabledNames };
}

/** Patch mesh-client reticulum config on disk before sidecar start. */
export function disableDecommissionedReticulumHubsInConfigDir(configDir: string): string[] {
  const configPath = joinUnderRoot(configDir, 'config');
  try {
    if (!fs.existsSync(configPath)) return [];
    const content = readUtf8FileBounded(configPath);
    const { next, disabledNames } = disableDecommissionedReticulumHubsInConfigContent(content);
    if (disabledNames.length === 0 || next === content) return [];
    // Atomic replace: write temp then rename into place.
    const tmpPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, next, 'utf8');
    fs.renameSync(tmpPath, configPath);
    return disabledNames;
  } catch (err) {
    console.warn(
      'mcL0278 [reticulum-decommissioned-hubs] failed to disable decommissioned hubs:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    return [];
  }
}
