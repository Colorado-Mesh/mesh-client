/**
 * MeshCom node command catalog (ICSSW CL/GW node commands).
 * Source: https://icssw.org/en/meshcom-kommandos-cl-gw/
 *
 * `app` = enterable via serial console **and** APP / BLE companion message.
 * `serial` = serial/USB console only (not intended for APP).
 *
 * Import this module only from the lazy Radio panel path — keep App runtime on
 * `meshcomCommandWire.ts` so the catalog stays out of the App entry chunk.
 */

import { buildMeshcomSettimeCommand } from './meshcomCommandWire';
import { sanitizeMeshcomWireLine } from './meshcomWireSanitize';

export {
  formatMeshcomSettimeUtc,
  normalizeMeshcomCommandInput,
  redactMeshcomCommandForLog,
} from './meshcomCommandWire';

/**
 * Transport eligibility for the Radio catalog badge.
 * `app` = sendable over Serial or BLE companion (`0xA0` / console `--` text).
 * `serial` = reserved for rare USB-console-only entries (none currently).
 */
export type MeshcomCommandChannel = 'app' | 'serial';

export type MeshcomCommandGroup =
  | 'display'
  | 'position'
  | 'sensors'
  | 'identity'
  | 'network'
  | 'gateway'
  | 'bluetooth'
  | 'neighbors'
  | 'mailbox'
  | 'debug'
  | 'power'
  | 'misc';

export type MeshcomCommandArgKind =
  'none' | 'onOff' | 'text' | 'number' | 'choice' | 'settime' | 'custom';

export interface MeshcomCommandDescriptor {
  /** Stable id (also used for i18n segment). */
  id: string;
  /** Leading token without args, e.g. `--volt`. */
  token: string;
  channel: MeshcomCommandChannel;
  group: MeshcomCommandGroup;
  argKind: MeshcomCommandArgKind;
  /** Allowed values for `choice` / common `onOff` extras. */
  choices?: readonly string[];
  /** Placeholder hint for free-text / number args. */
  argHint?: string;
  /** Redact argument in logs (WiFi password, webpwd, BLE PIN, node --passwd). */
  sensitive?: boolean;
  /** Confirm before send (reboot / OTA / factory rotate). */
  danger?: boolean;
  /** Firmware #ifdef or hardware note (UI hint only). */
  restriction?: string;
  /**
   * When true, Device Configuration blocks send on known stock ICSSW firmware
   * (MeshCom RM / kocel only — e.g. `--battcal`, `--e22pa`).
   */
  requiresRmFirmware?: boolean;
}

/**
 * Full ICSSW command catalog. All current entries are `channel: 'app'` (Serial + BLE).
 * Order within a group is display order.
 */
export const MESHCOM_COMMANDS: readonly MeshcomCommandDescriptor[] = [
  // ── Display (APP) ──
  { id: 'volt', token: '--volt', channel: 'app', group: 'display', argKind: 'onOff' },
  { id: 'proz', token: '--proz', channel: 'app', group: 'display', argKind: 'onOff' },
  {
    id: 'maxv',
    token: '--maxv',
    channel: 'app',
    group: 'display',
    argKind: 'number',
    argHint: '99.9',
  },
  { id: 'rxboost', token: '--rxboost', channel: 'app', group: 'display', argKind: 'onOff' },
  { id: 'button', token: '--button', channel: 'app', group: 'display', argKind: 'onOff' },
  {
    id: 'buttonGpio',
    token: '--button gpio',
    channel: 'app',
    group: 'display',
    argKind: 'number',
    argHint: 'N',
  },
  { id: 'all', token: '--all', channel: 'app', group: 'display', argKind: 'none' },
  { id: 'msg', token: '--msg', channel: 'app', group: 'display', argKind: 'none' },
  { id: 'display', token: '--display', channel: 'app', group: 'display', argKind: 'onOff' },
  {
    id: 'rotate',
    token: '--rotate',
    channel: 'app',
    group: 'display',
    argKind: 'choice',
    choices: ['0', '90', '180', '270'],
    danger: true,
  },

  // ── Position (APP) ──
  { id: 'sendpos', token: '--sendpos', channel: 'app', group: 'position', argKind: 'none' },
  {
    id: 'setlat',
    token: '--setlat',
    channel: 'app',
    group: 'position',
    argKind: 'number',
    argHint: 'xx.xxxxxx',
  },
  {
    id: 'setlon',
    token: '--setlon',
    channel: 'app',
    group: 'position',
    argKind: 'number',
    argHint: 'xxx.xxxxxx',
  },
  {
    id: 'setalt',
    token: '--setalt',
    channel: 'app',
    group: 'position',
    argKind: 'number',
    argHint: 'xxxxx',
  },
  {
    id: 'utcoff',
    token: '--utcoff',
    channel: 'app',
    group: 'position',
    argKind: 'number',
    argHint: '+/-99.9',
  },
  { id: 'settime', token: '--settime', channel: 'app', group: 'position', argKind: 'settime' },
  { id: 'gps', token: '--gps', channel: 'app', group: 'position', argKind: 'onOff' },
  { id: 'track', token: '--track', channel: 'app', group: 'position', argKind: 'onOff' },
  {
    id: 'postime',
    token: '--postime',
    channel: 'app',
    group: 'position',
    argKind: 'number',
    argHint: '300',
  },
  {
    id: 'aprsmc',
    token: '--aprsmc',
    channel: 'app',
    group: 'position',
    argKind: 'text',
    argHint: 'APRSMC',
  },
  { id: 'pos', token: '--pos', channel: 'app', group: 'position', argKind: 'none' },

  // ── Sensors (APP) ──
  { id: 'wx', token: '--wx', channel: 'app', group: 'sensors', argKind: 'none' },
  {
    id: 'bme',
    token: '--bme',
    channel: 'app',
    group: 'sensors',
    argKind: 'choice',
    choices: ['on'],
  },
  {
    id: 'bmp',
    token: '--bmp',
    channel: 'app',
    group: 'sensors',
    argKind: 'choice',
    choices: ['on'],
  },
  {
    id: 'bmx',
    token: '--bmx',
    channel: 'app',
    group: 'sensors',
    argKind: 'choice',
    choices: ['off'],
  },
  { id: '680', token: '--680', channel: 'app', group: 'sensors', argKind: 'onOff' },
  { id: '390', token: '--390', channel: 'app', group: 'sensors', argKind: 'onOff' },
  { id: '811', token: '--811', channel: 'app', group: 'sensors', argKind: 'onOff' },
  { id: 'aht20', token: '--aht20', channel: 'app', group: 'sensors', argKind: 'onOff' },
  { id: 'sht21', token: '--sht21', channel: 'app', group: 'sensors', argKind: 'onOff' },
  { id: 'lps33', token: '--lps33', channel: 'app', group: 'sensors', argKind: 'onOff' },
  { id: 'onewire', token: '--onewire', channel: 'app', group: 'sensors', argKind: 'onOff' },
  {
    id: 'onewireGpio',
    token: '--onewire gpio',
    channel: 'app',
    group: 'sensors',
    argKind: 'number',
    argHint: '99',
  },
  {
    id: 'tempoff',
    token: '--tempoff',
    channel: 'app',
    group: 'sensors',
    argKind: 'number',
    argHint: '-1.5',
  },
  {
    id: 'shunt',
    token: '--shunt',
    channel: 'app',
    group: 'sensors',
    argKind: 'number',
    argHint: '0.002',
  },
  {
    id: 'imax',
    token: '--imax',
    channel: 'app',
    group: 'sensors',
    argKind: 'number',
    argHint: '20',
  },
  {
    id: 'isamp',
    token: '--isamp',
    channel: 'app',
    group: 'sensors',
    argKind: 'number',
    argHint: '0',
  },
  { id: 'showi2c', token: '--showi2c', channel: 'app', group: 'sensors', argKind: 'none' },
  { id: 'io', token: '--io', channel: 'app', group: 'sensors', argKind: 'none' },
  {
    id: 'setio',
    token: '--setio',
    channel: 'app',
    group: 'sensors',
    argKind: 'custom',
    argHint: 'A0 out',
  },
  {
    id: 'setout',
    token: '--setout',
    channel: 'app',
    group: 'sensors',
    argKind: 'custom',
    argHint: 'A0 high',
  },
  // Dynamic APRS telemetry (ICSSW telemetrie-dynamisch-zusammenstellen) — RF→server→aprs.fi
  {
    id: 'parm',
    token: '--parm',
    channel: 'app',
    group: 'sensors',
    argKind: 'text',
    argHint: 'tm1,tm2,tm3,tm4,tm5',
  },
  {
    id: 'unit',
    token: '--unit',
    channel: 'app',
    group: 'sensors',
    argKind: 'text',
    argHint: 'V,A,mV,C,hPa',
  },
  {
    id: 'eqns',
    token: '--eqns',
    channel: 'app',
    group: 'sensors',
    argKind: 'text',
    argHint: '0,1,0, 0,1,0, 0,1,0, 0,1,0, 0,1,0',
  },
  {
    id: 'values',
    token: '--values',
    channel: 'app',
    group: 'sensors',
    argKind: 'text',
    argHint: 'temp,onewire,press,qnh,hum',
  },
  {
    id: 'ptime',
    token: '--ptime',
    channel: 'app',
    group: 'sensors',
    argKind: 'number',
    argHint: '15',
  },
  { id: 'tel', token: '--tel', channel: 'app', group: 'sensors', argKind: 'none' },

  // ── Identity (APP) ──
  {
    id: 'setcall',
    token: '--setcall',
    channel: 'app',
    group: 'identity',
    argKind: 'text',
    argHint: 'CALL-SSID',
    danger: true,
  },
  {
    id: 'operatorname',
    token: '--operatorname',
    channel: 'app',
    group: 'identity',
    argKind: 'text',
    argHint: 'firstname',
  },
  {
    id: 'aprscomment',
    token: '--aprscomment',
    channel: 'app',
    group: 'identity',
    argKind: 'text',
    argHint: 'textinfo',
  },
  {
    id: 'symid',
    token: '--symid',
    channel: 'app',
    group: 'identity',
    argKind: 'text',
    argHint: '/',
  },
  {
    id: 'symcd',
    token: '--symcd',
    channel: 'app',
    group: 'identity',
    argKind: 'text',
    argHint: '#',
  },
  {
    id: 'setctry',
    token: '--setctry',
    channel: 'app',
    group: 'identity',
    argKind: 'text',
    argHint: 'EU,UK,US,ON,PL,…',
    danger: true,
  },
  {
    id: 'setgrc',
    token: '--setgrc',
    channel: 'app',
    group: 'identity',
    argKind: 'custom',
    argHint: '232;2321;262;20',
  },
  { id: 'nomsgall', token: '--nomsgall', channel: 'app', group: 'identity', argKind: 'onOff' },

  // ── Network / WiFi (APP) ──
  {
    id: 'setssid',
    token: '--setssid',
    channel: 'app',
    group: 'network',
    argKind: 'text',
    argHint: 'WIFIssid',
    danger: true,
  },
  {
    id: 'setpwd',
    token: '--setpwd',
    channel: 'app',
    group: 'network',
    argKind: 'text',
    argHint: 'WIFIpassword',
    sensitive: true,
    danger: true,
  },
  { id: 'wifiap', token: '--wifiap', channel: 'app', group: 'network', argKind: 'onOff' },
  { id: 'webserver', token: '--webserver', channel: 'app', group: 'network', argKind: 'onOff' },
  {
    id: 'webpwd',
    token: '--webpwd',
    channel: 'app',
    group: 'network',
    argKind: 'text',
    argHint: 'password',
    sensitive: true,
  },
  {
    id: 'setownip',
    token: '--setownip',
    channel: 'app',
    group: 'network',
    argKind: 'text',
    argHint: 'xxx.xxx.xxx.xxx',
  },
  {
    id: 'setowngw',
    token: '--setowngw',
    channel: 'app',
    group: 'network',
    argKind: 'text',
    argHint: 'xxx.xxx.xxx.xxx',
  },
  {
    id: 'setownms',
    token: '--setownms',
    channel: 'app',
    group: 'network',
    argKind: 'text',
    argHint: 'xxx.xxx.xxx.xxx',
  },
  {
    id: 'extudpip',
    token: '--extudpip',
    channel: 'app',
    group: 'network',
    argKind: 'text',
    argHint: 'xxx.xxx.xxx.xxx',
  },
  { id: 'extudp', token: '--extudp', channel: 'app', group: 'network', argKind: 'onOff' },

  // ── Gateway (APP + serial extras) ──
  { id: 'gateway', token: '--gateway', channel: 'app', group: 'gateway', argKind: 'onOff' },
  {
    id: 'gatewaySrv',
    token: '--gateway srv',
    channel: 'app',
    group: 'gateway',
    argKind: 'choice',
    choices: ['oe', 'dl'],
  },
  { id: 'sethamnet', token: '--sethamnet', channel: 'app', group: 'gateway', argKind: 'onOff' },
  { id: 'setinet', token: '--setinet', channel: 'app', group: 'gateway', argKind: 'onOff' },

  // ── Bluetooth (APP) ──
  {
    id: 'btcode',
    token: '--btcode',
    channel: 'app',
    group: 'bluetooth',
    argKind: 'text',
    argHint: 'NNNNNN',
    sensitive: true,
  },
  {
    id: 'ble',
    token: '--ble',
    channel: 'app',
    group: 'bluetooth',
    argKind: 'choice',
    choices: ['long', 'short'],
  },

  // ── Neighbors (serial / new) ──
  {
    id: 'neighbours',
    token: '--neighbours',
    channel: 'app',
    group: 'neighbors',
    argKind: 'none',
  },
  { id: 'nbrreset', token: '--nbrreset', channel: 'app', group: 'neighbors', argKind: 'none' },
  { id: 'nbrcheck', token: '--nbrcheck', channel: 'app', group: 'neighbors', argKind: 'none' },
  { id: 'nbrdebug', token: '--nbrdebug', channel: 'app', group: 'neighbors', argKind: 'onOff' },
  {
    id: 'nbrrelay',
    token: '--nbrrelay',
    channel: 'app',
    group: 'neighbors',
    argKind: 'choice',
    choices: ['off', 'count', 'on'],
  },
  { id: 'nbrsym', token: '--nbrsym', channel: 'app', group: 'neighbors', argKind: 'onOff' },
  {
    id: 'nbrreport',
    token: '--nbrreport',
    channel: 'app',
    group: 'neighbors',
    argKind: 'choice',
    choices: ['off', 'auto', 'on'],
  },

  // ── Mailbox (serial; ENABLE_MSGSTORE) ──
  {
    id: 'store',
    token: '--store',
    channel: 'app',
    group: 'mailbox',
    argKind: 'choice',
    choices: ['off', 'own', 'list', 'heard'],
    restriction: 'ENABLE_MSGSTORE',
  },
  {
    id: 'storecall',
    token: '--storecall',
    channel: 'app',
    group: 'mailbox',
    argKind: 'text',
    argHint: 'CALL or none',
    restriction: 'ENABLE_MSGSTORE',
  },
  {
    id: 'storeslots',
    token: '--storeslots',
    channel: 'app',
    group: 'mailbox',
    argKind: 'number',
    argHint: '1–50',
    restriction: 'ENABLE_MSGSTORE',
  },
  {
    id: 'storetime',
    token: '--storetime',
    channel: 'app',
    group: 'mailbox',
    argKind: 'number',
    argHint: '1–168',
    restriction: 'ENABLE_MSGSTORE',
  },
  {
    id: 'storenotice',
    token: '--storenotice',
    channel: 'app',
    group: 'mailbox',
    argKind: 'onOff',
    restriction: 'ENABLE_MSGSTORE',
  },
  {
    id: 'mbox',
    token: '--mbox',
    channel: 'app',
    group: 'mailbox',
    argKind: 'none',
    restriction: 'ENABLE_MSGSTORE',
  },

  // ── Debug / status (mostly serial) ──
  { id: 'help', token: '--help', channel: 'app', group: 'debug', argKind: 'none' },
  { id: 'info', token: '--info', channel: 'app', group: 'debug', argKind: 'none' },
  { id: 'mheard', token: '--mheard', channel: 'app', group: 'debug', argKind: 'none' },
  { id: 'mh', token: '--mh', channel: 'app', group: 'debug', argKind: 'none' },
  { id: 'path', token: '--path', channel: 'app', group: 'debug', argKind: 'none' },
  { id: 'msgid', token: '--msgid', channel: 'app', group: 'debug', argKind: 'none' },
  {
    id: 'airgap',
    token: '--airgap',
    channel: 'app',
    group: 'debug',
    argKind: 'choice',
    choices: ['on', 'off', 'show'],
  },
  {
    id: 'dumpsettings',
    token: '--dumpsettings',
    channel: 'app',
    group: 'debug',
    argKind: 'none',
    restriction: 'nRF52',
  },
  { id: 'loradebug', token: '--loradebug', channel: 'app', group: 'debug', argKind: 'onOff' },
  { id: 'gpsdebug', token: '--gpsdebug', channel: 'app', group: 'debug', argKind: 'onOff' },
  { id: 'wxdebug', token: '--wxdebug', channel: 'app', group: 'debug', argKind: 'onOff' },
  { id: 'bledebug', token: '--bledebug', channel: 'app', group: 'debug', argKind: 'onOff' },
  { id: 'setlog', token: '--setlog', channel: 'app', group: 'debug', argKind: 'onOff' },
  { id: 'setinfo', token: '--setinfo', channel: 'app', group: 'debug', argKind: 'onOff' },
  { id: 'setnoinfo', token: '--setnoinfo', channel: 'app', group: 'debug', argKind: 'none' },
  {
    id: 'softserdebug',
    token: '--softserdebug',
    channel: 'app',
    group: 'debug',
    argKind: 'onOff',
  },
  {
    id: 'battprobe',
    token: '--battprobe',
    channel: 'app',
    group: 'debug',
    argKind: 'number',
    argHint: '1–10',
    restriction: 'INSTRUMENT_ENABLED',
  },
  {
    id: 'keylock',
    token: '--keylock',
    channel: 'app',
    group: 'debug',
    argKind: 'onOff',
    restriction: 'T-Deck',
  },
  {
    id: 'ethmtu',
    token: '--ethmtu',
    channel: 'app',
    group: 'network',
    argKind: 'number',
    argHint: '1280–1500',
    restriction: 'RAK4631',
  },
  {
    id: 'pingcall',
    token: '--pingcall',
    channel: 'app',
    group: 'debug',
    argKind: 'text',
    argHint: 'CALL or none',
  },
  {
    id: 'pingtime',
    token: '--pingtime',
    channel: 'app',
    group: 'debug',
    argKind: 'number',
    argHint: '30–300',
  },
  {
    id: 'pingmax',
    token: '--pingmax',
    channel: 'app',
    group: 'debug',
    argKind: 'number',
    argHint: '1–5',
  },
  {
    id: 'ping',
    token: '--ping',
    channel: 'app',
    group: 'debug',
    argKind: 'choice',
    choices: ['start', 'stop'],
  },

  // ── Power / OTA / mesh (APP + serial) ──
  {
    id: 'txpower',
    token: '--txpower',
    channel: 'app',
    group: 'power',
    argKind: 'number',
    argHint: 'dBm',
  },
  {
    id: 'battcal',
    token: '--battcal',
    channel: 'app',
    group: 'power',
    argKind: 'number',
    argHint: 'V',
    requiresRmFirmware: true,
    restriction: 'MeshCom RM / kocel',
  },
  {
    id: 'e22pa',
    token: '--e22pa',
    channel: 'app',
    group: 'power',
    argKind: 'choice',
    choices: ['0', '22', '30', '33'],
    requiresRmFirmware: true,
    restriction: 'MeshCom RM / kocel (0=unknown, 22=M22S, 30=M30S, 33=M33S)',
  },
  {
    id: 'mesh',
    token: '--mesh',
    channel: 'app',
    group: 'power',
    argKind: 'onOff',
  },
  {
    id: 'reboot',
    token: '--reboot',
    channel: 'app',
    group: 'power',
    argKind: 'none',
    danger: true,
  },
  {
    id: 'save',
    token: '--save',
    channel: 'app',
    group: 'power',
    argKind: 'none',
    danger: true,
  },
  {
    id: 'deepsleep',
    token: '--deepsleep',
    channel: 'app',
    group: 'power',
    argKind: 'none',
    danger: true,
  },
  {
    id: 'otaUpdate',
    token: '--ota-update',
    channel: 'app',
    group: 'power',
    argKind: 'none',
    danger: true,
  },
  {
    id: 'sendtrack',
    token: '--sendtrack',
    channel: 'app',
    group: 'position',
    argKind: 'none',
  },

  // ── Misc serial bootstrap (KISS) ──
  { id: 'kiss', token: '--kiss', channel: 'app', group: 'misc', argKind: 'onOff' },
  {
    id: 'kissTx',
    token: '--kiss tx',
    channel: 'app',
    group: 'misc',
    argKind: 'onOff',
  },
  {
    id: 'kissMeta',
    token: '--kiss meta',
    channel: 'app',
    group: 'misc',
    argKind: 'onOff',
  },
  {
    id: 'kissAuth',
    token: '--kiss auth',
    channel: 'app',
    group: 'misc',
    argKind: 'onOff',
  },
  {
    id: 'netconsole',
    token: '--netconsole',
    channel: 'app',
    group: 'network',
    argKind: 'onOff',
  },
  {
    id: 'passwd',
    token: '--passwd',
    channel: 'app',
    group: 'network',
    argKind: 'text',
    argHint: 'max 14 chars; none clears',
    sensitive: true,
  },
];

export const MESHCOM_COMMAND_GROUPS: readonly MeshcomCommandGroup[] = [
  'display',
  'position',
  'sensors',
  'identity',
  'network',
  'gateway',
  'bluetooth',
  'neighbors',
  'mailbox',
  'debug',
  'power',
  'misc',
];

const BY_ID = new Map(MESHCOM_COMMANDS.map((c) => [c.id, c]));

/** Catalog tokens that require MeshCom RM / kocel firmware (`requiresRmFirmware`). */
export const MESHCOM_RM_ONLY_COMMAND_TOKENS: ReadonlySet<string> = new Set(
  MESHCOM_COMMANDS.filter((c) => c.requiresRmFirmware).map((c) => c.token.toLowerCase()),
);

export function getMeshcomCommandById(id: string): MeshcomCommandDescriptor | undefined {
  return BY_ID.get(id);
}

export function buildMeshcomCommandLine(
  descriptor: MeshcomCommandDescriptor,
  arg?: string,
): string {
  if (descriptor.argKind === 'none') return descriptor.token;
  if (descriptor.argKind === 'settime') {
    return buildMeshcomSettimeCommand();
  }
  if (descriptor.id === 'setgrc' && (arg == null || arg.trim() === '')) {
    return '--setgrc';
  }
  const value = sanitizeMeshcomWireLine((arg ?? '').trim());
  if (!value && descriptor.argKind !== 'custom') {
    throw new Error(`meshcom command ${descriptor.token} requires an argument`);
  }
  return value ? `${descriptor.token} ${value}` : descriptor.token;
}
