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

export {
  buildMeshcomSettimeCommand,
  formatMeshcomSettimeUtc,
  isMeshcomSensitiveCommand,
  MESHCOM_APP_SHORTCUTS,
  normalizeMeshcomCommandInput,
  redactMeshcomCommandForLog,
} from './meshcomCommandWire';

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
  /** Redact argument in logs (WiFi password, webpwd, BLE PIN). */
  sensitive?: boolean;
  /** Confirm before send (reboot / OTA / factory rotate). */
  danger?: boolean;
  /** Firmware #ifdef or hardware note (UI hint only). */
  restriction?: string;
}

/**
 * Full catalog including new serial/USB commands and APP/serial lists from ICSSW.
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
    channel: 'serial',
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
  { id: '811', token: '--811', channel: 'app', group: 'sensors', argKind: 'onOff' },
  { id: 'onewire', token: '--onewire', channel: 'app', group: 'sensors', argKind: 'onOff' },
  {
    id: 'onewireGpio',
    token: '--onewire gpio',
    channel: 'app',
    group: 'sensors',
    argKind: 'number',
    argHint: '99',
  },
  { id: 'showi2c', token: '--showi2c', channel: 'app', group: 'sensors', argKind: 'none' },

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
    id: 'setctry',
    token: '--setctry',
    channel: 'app',
    group: 'identity',
    argKind: 'text',
    argHint: 'EU',
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
  { id: 'sethamnet', token: '--sethamnet', channel: 'serial', group: 'gateway', argKind: 'onOff' },
  { id: 'setinet', token: '--setinet', channel: 'serial', group: 'gateway', argKind: 'onOff' },

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

  // ── Neighbors (serial / new) ──
  {
    id: 'neighbours',
    token: '--neighbours',
    channel: 'serial',
    group: 'neighbors',
    argKind: 'none',
  },
  { id: 'nbrreset', token: '--nbrreset', channel: 'serial', group: 'neighbors', argKind: 'none' },
  { id: 'nbrcheck', token: '--nbrcheck', channel: 'serial', group: 'neighbors', argKind: 'none' },
  { id: 'nbrdebug', token: '--nbrdebug', channel: 'serial', group: 'neighbors', argKind: 'onOff' },
  {
    id: 'nbrrelay',
    token: '--nbrrelay',
    channel: 'serial',
    group: 'neighbors',
    argKind: 'choice',
    choices: ['off', 'count', 'on'],
  },
  { id: 'nbrsym', token: '--nbrsym', channel: 'serial', group: 'neighbors', argKind: 'onOff' },
  {
    id: 'nbrreport',
    token: '--nbrreport',
    channel: 'serial',
    group: 'neighbors',
    argKind: 'choice',
    choices: ['off', 'auto', 'on'],
  },

  // ── Mailbox (serial; ENABLE_MSGSTORE) ──
  {
    id: 'store',
    token: '--store',
    channel: 'serial',
    group: 'mailbox',
    argKind: 'choice',
    choices: ['off', 'own', 'list', 'heard'],
    restriction: 'ENABLE_MSGSTORE',
  },
  {
    id: 'storecall',
    token: '--storecall',
    channel: 'serial',
    group: 'mailbox',
    argKind: 'text',
    argHint: 'CALL or none',
    restriction: 'ENABLE_MSGSTORE',
  },
  {
    id: 'storeslots',
    token: '--storeslots',
    channel: 'serial',
    group: 'mailbox',
    argKind: 'number',
    argHint: '1–50',
    restriction: 'ENABLE_MSGSTORE',
  },
  {
    id: 'storetime',
    token: '--storetime',
    channel: 'serial',
    group: 'mailbox',
    argKind: 'number',
    argHint: '1–168',
    restriction: 'ENABLE_MSGSTORE',
  },
  {
    id: 'storenotice',
    token: '--storenotice',
    channel: 'serial',
    group: 'mailbox',
    argKind: 'onOff',
    restriction: 'ENABLE_MSGSTORE',
  },
  {
    id: 'mbox',
    token: '--mbox',
    channel: 'serial',
    group: 'mailbox',
    argKind: 'none',
    restriction: 'ENABLE_MSGSTORE',
  },

  // ── Debug / status (mostly serial) ──
  { id: 'help', token: '--help', channel: 'app', group: 'debug', argKind: 'none' },
  { id: 'info', token: '--info', channel: 'serial', group: 'debug', argKind: 'none' },
  { id: 'mheard', token: '--mheard', channel: 'serial', group: 'debug', argKind: 'none' },
  { id: 'path', token: '--path', channel: 'serial', group: 'debug', argKind: 'none' },
  { id: 'msgid', token: '--msgid', channel: 'serial', group: 'debug', argKind: 'none' },
  {
    id: 'airgap',
    token: '--airgap',
    channel: 'serial',
    group: 'debug',
    argKind: 'choice',
    choices: ['on', 'off', 'show'],
  },
  {
    id: 'dumpsettings',
    token: '--dumpsettings',
    channel: 'serial',
    group: 'debug',
    argKind: 'none',
    restriction: 'nRF52',
  },
  { id: 'loradebug', token: '--loradebug', channel: 'serial', group: 'debug', argKind: 'onOff' },
  { id: 'gpsdebug', token: '--gpsdebug', channel: 'serial', group: 'debug', argKind: 'onOff' },
  { id: 'wxdebug', token: '--wxdebug', channel: 'serial', group: 'debug', argKind: 'onOff' },
  { id: 'bledebug', token: '--bledebug', channel: 'serial', group: 'debug', argKind: 'onOff' },
  { id: 'setlog', token: '--setlog', channel: 'serial', group: 'debug', argKind: 'onOff' },
  { id: 'setinfo', token: '--setinfo', channel: 'serial', group: 'debug', argKind: 'onOff' },
  {
    id: 'softserdebug',
    token: '--softserdebug',
    channel: 'serial',
    group: 'debug',
    argKind: 'onOff',
  },
  {
    id: 'battprobe',
    token: '--battprobe',
    channel: 'serial',
    group: 'debug',
    argKind: 'number',
    argHint: '1–10',
    restriction: 'INSTRUMENT_ENABLED',
  },
  {
    id: 'keylock',
    token: '--keylock',
    channel: 'serial',
    group: 'debug',
    argKind: 'onOff',
    restriction: 'T-Deck',
  },
  {
    id: 'ethmtu',
    token: '--ethmtu',
    channel: 'serial',
    group: 'network',
    argKind: 'number',
    argHint: '1280–1500',
    restriction: 'RAK4631',
  },
  {
    id: 'pingcall',
    token: '--pingcall',
    channel: 'serial',
    group: 'debug',
    argKind: 'text',
    argHint: 'CALL or none',
  },
  {
    id: 'pingtime',
    token: '--pingtime',
    channel: 'serial',
    group: 'debug',
    argKind: 'number',
    argHint: '30–300',
  },
  {
    id: 'pingmax',
    token: '--pingmax',
    channel: 'serial',
    group: 'debug',
    argKind: 'number',
    argHint: '1–5',
  },
  {
    id: 'ping',
    token: '--ping',
    channel: 'serial',
    group: 'debug',
    argKind: 'choice',
    choices: ['start', 'stop'],
  },

  // ── Power / OTA (APP) ──
  {
    id: 'reboot',
    token: '--reboot',
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

  // ── Misc serial bootstrap (KISS) ──
  { id: 'kiss', token: '--kiss', channel: 'serial', group: 'misc', argKind: 'onOff' },
  {
    id: 'kissTx',
    token: '--kiss tx',
    channel: 'serial',
    group: 'misc',
    argKind: 'onOff',
  },
  {
    id: 'kissMeta',
    token: '--kiss meta',
    channel: 'serial',
    group: 'misc',
    argKind: 'onOff',
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

export function getMeshcomCommandById(id: string): MeshcomCommandDescriptor | undefined {
  return BY_ID.get(id);
}

export function getMeshcomCommandsByGroup(group: MeshcomCommandGroup): MeshcomCommandDescriptor[] {
  return MESHCOM_COMMANDS.filter((c) => c.group === group);
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
  const value = (arg ?? '').trim();
  if (!value && descriptor.argKind !== 'custom') {
    throw new Error(`meshcom command ${descriptor.token} requires an argument`);
  }
  return value ? `${descriptor.token} ${value}` : descriptor.token;
}
