#!/usr/bin/env node
/**
 * Linux dev entry: ambient CAP_NET_RAW for BLE without setcap on local Electron.
 * Keep aligned with src/shared/linuxBleDevLaunch.ts (LINUX_BLE_DEV_LAUNCH_SETPRIV_SNIPPET).
 */
import { execFileSync, spawnSync } from 'child_process';

if (process.platform !== 'linux') {
  console.error('[mesh-client] npm run linux is only for Linux development.');
  process.exit(1);
}

const user = process.env.USER || process.env.LOGNAME;
if (!user) {
  console.error('[mesh-client] USER is not set.');
  process.exit(1);
}

let gid;
try {
  gid = execFileSync('id', ['-g'], { encoding: 'utf8' }).trim();
} catch {
  console.error('[mesh-client] id -g failed.');
  process.exit(1);
}

/** Skip sentinel values that Chromium/libdbus cannot parse (e.g. Flatpak/sandbox "disabled:"). */
function dbusSessionBusAddressToExport() {
  const v = process.env.DBUS_SESSION_BUS_ADDRESS;
  if (v === undefined || v === null || typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase();
  if (t === '' || t.startsWith('disabled')) return undefined;
  return v;
}

const pathEnv = JSON.stringify(process.env.PATH ?? '');
const display = JSON.stringify(process.env.DISPLAY ?? '');
const xauth = JSON.stringify(process.env.XAUTHORITY ?? '');
const dbusSession = dbusSessionBusAddressToExport();
const xdgRuntime = process.env.XDG_RUNTIME_DIR;
const xdgSessionId = process.env.XDG_SESSION_ID;

const preExports = [];
if (dbusSession !== undefined) {
  preExports.push(`export DBUS_SESSION_BUS_ADDRESS=${JSON.stringify(dbusSession)}`);
}
if (xdgRuntime) {
  preExports.push(`export XDG_RUNTIME_DIR=${JSON.stringify(xdgRuntime)}`);
}
if (xdgSessionId) {
  preExports.push(`export XDG_SESSION_ID=${JSON.stringify(xdgSessionId)}`);
}

const pre = preExports.length ? `${preExports.join('; ')}; ` : '';
const inner = `${pre}export PATH=${pathEnv}; export DISPLAY=${display}; export XAUTHORITY=${xauth}; npm start -- -no-sandbox`;

const result = spawnSync(
  'sudo',
  [
    'setpriv',
    `--reuid=${user}`,
    `--regid=${gid}`,
    '--init-groups',
    '--inh-caps',
    '+net_raw',
    '--ambient-caps',
    '+net_raw',
    '--reset-env',
    'bash',
    '-lc',
    inner,
  ],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(String(result.error));
  process.exit(1);
}

process.exit(result.status ?? 1);
