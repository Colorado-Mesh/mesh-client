import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

import type { SystemReticulumInstance } from '../shared/reticulum-types';
import { defaultReticulumConfigPaths } from './reticulum-config-paths';
import { readUtf8FileBounded } from './reticulum-config-read';

const DEFAULT_SHARED_INSTANCE_PORT = 37428;
const DEFAULT_INSTANCE_NAME = 'default';
const PROBE_TIMEOUT_MS = 500;
const SERIAL_INTERFACE_TYPES = new Set(['rnodeinterface', 'kissinterface', 'ax25kissinterface']);

export interface ParsedSystemReticulumConfig {
  shareInstance: boolean;
  sharedInstanceType: 'tcp' | 'unix' | null;
  sharedInstancePort: number;
  instanceName: string;
  serialPorts: string[];
}

/** Python RNS search order, then mesh-client's import defaults (deduped). */
export function systemReticulumConfigCandidates(platform: NodeJS.Platform): string[] {
  const home = os.homedir();
  const python =
    platform === 'win32'
      ? []
      : [
          '/etc/reticulum/config',
          path.join(home, '.config', 'reticulum', 'config'),
          path.join(home, '.reticulum', 'config'),
        ];
  return [...new Set([...python, ...defaultReticulumConfigPaths()])];
}

function parseIniBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (['yes', 'true', 'on', '1'].includes(v)) return true;
  if (['no', 'false', 'off', '0'].includes(v)) return false;
  return null;
}

function stripInlineComment(value: string): string {
  const hash = value.indexOf(' #');
  return (hash === -1 ? value : value.slice(0, hash)).trim();
}

/** ConfigObj-style parse of the `[reticulum]` section and serial interface ports. */
export function parseSystemReticulumConfig(content: string): ParsedSystemReticulumConfig {
  const result: ParsedSystemReticulumConfig = {
    shareInstance: true,
    sharedInstanceType: null,
    sharedInstancePort: DEFAULT_SHARED_INSTANCE_PORT,
    instanceName: DEFAULT_INSTANCE_NAME,
    serialPorts: [],
  };
  let section = '';
  let iface: { type: string; port: string | null; enabled: boolean } | null = null;
  const flushInterface = () => {
    if (iface?.enabled && iface.port && SERIAL_INTERFACE_TYPES.has(iface.type)) {
      result.serialPorts.push(iface.port);
    }
    iface = null;
  };
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[[') && line.endsWith(']]')) {
      flushInterface();
      if (section === 'interfaces') iface = { type: '', port: null, enabled: true };
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      flushInterface();
      section = line.slice(1, -1).trim().toLowerCase();
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = stripInlineComment(line.slice(eq + 1));
    if (iface) {
      if (key === 'type') iface.type = value.toLowerCase();
      else if (key === 'port') iface.port = value;
      else if (key === 'enabled' || key === 'interface_enabled') {
        iface.enabled = parseIniBool(value) ?? iface.enabled;
      }
      continue;
    }
    if (section !== 'reticulum') continue;
    if (key === 'share_instance') {
      result.shareInstance = parseIniBool(value) ?? result.shareInstance;
    } else if (key === 'shared_instance_type') {
      const t = value.toLowerCase();
      if (t === 'tcp' || t === 'unix') result.sharedInstanceType = t;
    } else if (key === 'shared_instance_port') {
      const port = Number.parseInt(value, 10);
      if (Number.isInteger(port) && port > 0 && port <= 65535) result.sharedInstancePort = port;
    } else if (key === 'instance_name' && value) {
      result.instanceName = value;
    }
  }
  flushInterface();
  return result;
}

/** Python RNS uses AF_UNIX abstract sockets on Linux/Android and TCP elsewhere. */
export function resolveSharedInstanceType(
  configured: 'tcp' | 'unix' | null,
  platform: NodeJS.Platform,
): 'tcp' | 'unix' {
  if (platform !== 'linux') return 'tcp';
  return configured ?? 'unix';
}

function probeConnect(opts: net.NetConnectOpts): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(opts);
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => {
      finish(false);
    });
    socket.once('connect', () => {
      finish(true);
    });
    socket.once('error', () => {
      finish(false);
    });
  });
}

export async function detectSystemReticulum(
  platform: NodeJS.Platform = process.platform,
  connect: (opts: net.NetConnectOpts) => Promise<boolean> = probeConnect,
): Promise<SystemReticulumInstance> {
  let configPath: string | null = null;
  let parsed = parseSystemReticulumConfig('');
  for (const candidate of systemReticulumConfigCandidates(platform)) {
    try {
      if (!fs.existsSync(candidate)) continue;
      parsed = parseSystemReticulumConfig(readUtf8FileBounded(candidate));
      configPath = candidate;
      break;
    } catch {
      // catch-no-log-ok: unreadable candidate; try the next system config path
    }
  }
  const sharedInstanceType = resolveSharedInstanceType(parsed.sharedInstanceType, platform);
  const endpoint =
    sharedInstanceType === 'tcp'
      ? `127.0.0.1:${parsed.sharedInstancePort}`
      : `rns/${parsed.instanceName}`;
  const running = parsed.shareInstance
    ? await connect(
        sharedInstanceType === 'tcp'
          ? { host: '127.0.0.1', port: parsed.sharedInstancePort }
          : { path: `\0rns/${parsed.instanceName}` },
      )
    : false;
  return {
    configPath,
    shareInstance: parsed.shareInstance,
    sharedInstanceType,
    endpoint,
    running,
    serialPorts: parsed.serialPorts,
  };
}
