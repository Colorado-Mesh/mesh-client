/**
 * Parse MeshCom node settings from BLE companion JSON (`TYP` packets after `{HELLO}`)
 * and Serial `--info` text, then map them onto Radio command field values.
 *
 * BLE field names follow ICSSW firmware `command_functions.cpp` (`sendInfo` / `sendNodeSetting` /
 * `sendWifiSetting` / `sendGpsJson` / `sendAPRSset`).
 */

import { normalizeMeshcomCallsign } from './meshcomCallsign';
import { parseMeshcomGrcListenList } from './meshcomGrcGroups';
import { formatMeshcomInstalledFirmware } from './meshcomHwIds';

/** Mutable accumulator while BLE config packets (or serial --info lines) arrive. */
export interface MeshcomDeviceSettingsAccum {
  call?: string;
  operatorName?: string;
  country?: string;
  btCode?: string;
  ble?: 'long' | 'short';
  maxv?: string;
  boost?: 'on' | 'off';
  /** Display on/off (inverse of firmware `DISP` = display-off). */
  display?: 'on' | 'off';
  button?: 'on' | 'off';
  volt?: 'on' | 'off';
  gps?: 'on' | 'off';
  track?: 'on' | 'off';
  gateway?: 'on' | 'off';
  webserver?: 'on' | 'off';
  mesh?: 'on' | 'off';
  nomsgall?: 'on' | 'off';
  utcoff?: string;
  postime?: string;
  lat?: string;
  lon?: string;
  alt?: string;
  ssid?: string;
  ownip?: string;
  owngw?: string;
  ownms?: string;
  extudp?: 'on' | 'off';
  extudpip?: string;
  wifiap?: 'on' | 'off';
  aprscomment?: string;
  symid?: string;
  symcd?: string;
  /** Group filter ids (GCBn), semicolon-joined for `--setgrc`. */
  groups?: string;
  txPower?: string;
  freqMhz?: string;
  fwver?: string;
  /**
   * Build stamp from BLE TYP `IS1` `BDATE` (`YYYYMMDD-HHMMSS`).
   * Serial embeds the equivalent in `fwver` as `(build: …)`.
   */
  buildDate?: string;
  bme?: 'on' | 'off';
  bmp?: 'on' | 'off';
  onewire?: 'on' | 'off';
  /** Battery percent from TYP I `BATP` or serial `--info`. */
  battPercent?: number;
  /** Battery volts from TYP I `BATV` or serial `--info`. */
  battVoltage?: number;
  /** Weather / sensors from TYP W or EXTUDP `tele`. */
  temperatureC?: number;
  humidityPct?: number;
  pressureHpa?: number;
  temperatureOutC?: number;
  gasResistance?: number;
  co2Ppm?: number;
  /** True after BLE `CONFFIN` or a finished serial `--info` collect window. */
  complete: boolean;
}

export interface MeshcomDeviceSettingsSnapshot {
  /** Values keyed by `MeshcomCommandDescriptor.id` for Radio field prefills. */
  valuesByCommandId: Readonly<Record<string, string>>;
  callsign: string;
  operatorName: string;
  countryCode: string;
  /**
   * Firmware revision for Connection / update-check display
   * (release-tag shape, e.g. `4.40a.11.22`).
   */
  firmwareVersion?: string;
  batteryLevel?: number;
  voltage?: number;
  temperatureC?: number;
  humidityPct?: number;
  pressureHpa?: number;
  temperatureOutC?: number;
  gasResistance?: number;
  co2Ppm?: number;
  /** Stations from serial `--mheard` when collected during refresh. */
  mheard?: readonly {
    callsign: string;
    rssi?: number;
    snr?: number;
    distanceKm?: number;
  }[];
  complete: boolean;
  updatedAt: number;
}

function asFiniteNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function onOff(v: unknown): 'on' | 'off' | undefined {
  if (v === true || v === 'on' || v === 1 || v === '1') return 'on';
  if (v === false || v === 'off' || v === 0 || v === '0') return 'off';
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function boolToDisplayOn(dispOff: unknown): 'on' | 'off' | undefined {
  const off = onOff(dispOff);
  if (off === 'on') return 'off';
  if (off === 'off') return 'on';
  if (typeof dispOff === 'boolean') return dispOff ? 'off' : 'on';
  return undefined;
}

type MeshcomStringAccumKey =
  | 'country'
  | 'maxv'
  | 'fwver'
  | 'utcoff'
  | 'txPower'
  | 'freqMhz'
  | 'ssid'
  | 'ownip'
  | 'owngw'
  | 'ownms'
  | 'extudpip'
  | 'lat'
  | 'lon'
  | 'alt'
  | 'postime'
  | 'symid'
  | 'symcd'
  | 'buildDate';

type MeshcomNumberAccumKey =
  | 'battPercent'
  | 'battVoltage'
  | 'temperatureC'
  | 'temperatureOutC'
  | 'humidityPct'
  | 'pressureHpa'
  | 'gasResistance'
  | 'co2Ppm';

function setStringField(
  accum: MeshcomDeviceSettingsAccum,
  key: MeshcomStringAccumKey,
  raw: unknown,
): void {
  const value = asString(raw);
  if (value) accum[key] = value;
}

function setOnOffField(
  accum: MeshcomDeviceSettingsAccum,
  key: MeshcomOnOffField,
  raw: unknown,
): void {
  const value = onOff(raw);
  if (value) accum[key] = value;
}

function setNumberField(
  accum: MeshcomDeviceSettingsAccum,
  key: MeshcomNumberAccumKey,
  raw: unknown,
): void {
  const value = asFiniteNumber(raw);
  if (value != null) accum[key] = value;
}

function mergeMeshcomBleInfo(
  accum: MeshcomDeviceSettingsAccum,
  doc: Record<string, unknown>,
): void {
  const call = asString(doc.CALL);
  if (call) accum.call = normalizeMeshcomCallsign(call) || call;
  setStringField(accum, 'country', doc.CTRY);
  const bpin = asString(doc.BPIN);
  if (bpin != null) accum.btCode = bpin.padStart(6, '0').slice(-6);
  const ble = asString(doc.BLE);
  if (ble === 'long' || ble === 'short') accum.ble = ble;
  setStringField(accum, 'maxv', doc.MAXV);
  setOnOffField(accum, 'boost', doc.BOOST);
  setStringField(accum, 'fwver', doc.FWVER);
  setNumberField(accum, 'battPercent', doc.BATP);
  setNumberField(accum, 'battVoltage', doc.BATV);
  const groups: string[] = [];
  for (let i = 0; i < 6; i++) {
    const g = asString(doc[`GCB${i}`]);
    if (g && g !== '0') groups.push(g);
  }
  if (groups.length > 0) accum.groups = groups.join(';');
}

const BLE_WEATHER_NUMBER_FIELDS: readonly (readonly [MeshcomNumberAccumKey, string])[] = [
  ['temperatureC', 'TEMP'],
  ['temperatureOutC', 'TOUT'],
  ['humidityPct', 'HUM'],
  ['gasResistance', 'GAS'],
  ['co2Ppm', 'CO2'],
];

function mergeMeshcomBleWeather(
  accum: MeshcomDeviceSettingsAccum,
  doc: Record<string, unknown>,
): void {
  for (const [field, key] of BLE_WEATHER_NUMBER_FIELDS) {
    setNumberField(accum, field, doc[key]);
  }
  const press = asFiniteNumber(doc.PRES) ?? asFiniteNumber(doc.QNH);
  if (press != null) accum.pressureHpa = press;
}

const BLE_NODE_ON_OFF_FIELDS: readonly (readonly [MeshcomOnOffField, string])[] = [
  ['gateway', 'GW'],
  ['webserver', 'WS'],
  ['button', 'BTN'],
  ['mesh', 'MSH'],
  ['gps', 'GPS'],
  ['track', 'TRACK'],
  ['nomsgall', 'NOALL'],
];

const BLE_NODE_STRING_FIELDS: readonly (readonly [MeshcomStringAccumKey, string])[] = [
  ['utcoff', 'UTCOF'],
  ['txPower', 'TXP'],
  ['freqMhz', 'MQRG'],
];

function mergeMeshcomBleNodeSettings(
  accum: MeshcomDeviceSettingsAccum,
  doc: Record<string, unknown>,
): void {
  for (const [field, key] of BLE_NODE_ON_OFF_FIELDS) setOnOffField(accum, field, doc[key]);
  for (const [field, key] of BLE_NODE_STRING_FIELDS) setStringField(accum, field, doc[key]);
  const disp = boolToDisplayOn(doc.DISP);
  if (disp) accum.display = disp;
}

function mergeMeshcomBleWifiSettings(
  accum: MeshcomDeviceSettingsAccum,
  doc: Record<string, unknown>,
): void {
  setStringField(accum, 'ssid', doc.SSID);
  setOnOffField(accum, 'wifiap', doc.AP);
}

function mergeMeshcomBleIpSettings(
  accum: MeshcomDeviceSettingsAccum,
  doc: Record<string, unknown>,
): void {
  setStringField(accum, 'ownip', doc.OWNIP);
  setStringField(accum, 'owngw', doc.OWNGW);
  setStringField(accum, 'ownms', doc.OWNMS);
  setOnOffField(accum, 'extudp', doc.EUDP);
  setStringField(accum, 'extudpip', doc.EUDPIP);
}

function mergeMeshcomBleGpsSettings(
  accum: MeshcomDeviceSettingsAccum,
  doc: Record<string, unknown>,
): void {
  setStringField(accum, 'lat', doc.LAT);
  setStringField(accum, 'lon', doc.LON);
  setStringField(accum, 'alt', doc.ALT);
  setStringField(accum, 'postime', doc.RATE);
}

function mergeMeshcomBleAprsSettings(
  accum: MeshcomDeviceSettingsAccum,
  doc: Record<string, unknown>,
): void {
  const atxt = asString(doc.ATXT);
  if (atxt && atxt !== 'none') accum.aprscomment = atxt;
  const name = asString(doc.NAME);
  if (name) accum.operatorName = name.slice(0, 19);
  setStringField(accum, 'symid', doc.SYMID);
  setStringField(accum, 'symcd', doc.SYMCD);
}

function mergeMeshcomBleSensorSettings(
  accum: MeshcomDeviceSettingsAccum,
  doc: Record<string, unknown>,
): void {
  setOnOffField(accum, 'bme', doc.BME);
  setOnOffField(accum, 'bmp', doc.BMP);
  setOnOffField(accum, 'onewire', doc.OW);
}

function mergeMeshcomBleBuildDate(
  accum: MeshcomDeviceSettingsAccum,
  doc: Record<string, unknown>,
): void {
  // Firmware companion JSON: `{"TYP":"IS1","BDATE":"YYYYMMDD-HHMMSS"}` (sendInfo).
  setStringField(accum, 'buildDate', doc.BDATE);
}

const MESHCOM_BLE_HANDLERS: Readonly<
  Partial<Record<string, (accum: MeshcomDeviceSettingsAccum, doc: Record<string, unknown>) => void>>
> = {
  I: mergeMeshcomBleInfo,
  W: mergeMeshcomBleWeather,
  SN: mergeMeshcomBleNodeSettings,
  SN1: (accum, doc) => {
    setOnOffField(accum, 'volt', doc.VOLT);
  },
  SW: mergeMeshcomBleWifiSettings,
  S2: mergeMeshcomBleIpSettings,
  G: mergeMeshcomBleGpsSettings,
  SA: mergeMeshcomBleAprsSettings,
  SE: mergeMeshcomBleSensorSettings,
  IS1: mergeMeshcomBleBuildDate,
};

/** Merge one BLE companion JSON object (`{"TYP":"I",...}`) into the accumulator. */
export function mergeMeshcomBleSettingsJson(
  accum: MeshcomDeviceSettingsAccum,
  raw: unknown,
): { confFin: boolean } {
  if (!raw || typeof raw !== 'object') return { confFin: false };
  const doc = raw as Record<string, unknown>;
  const typ = typeof doc.TYP === 'string' ? doc.TYP : '';
  if (typ === 'CONFFIN') {
    accum.complete = true;
    return { confFin: true };
  }
  const handler = MESHCOM_BLE_HANDLERS[typ];
  if (handler) handler(accum, doc);
  return { confFin: false };
}

type MeshcomOnOffField =
  | 'boost'
  | 'volt'
  | 'wifiap'
  | 'display'
  | 'button'
  | 'gps'
  | 'track'
  | 'gateway'
  | 'webserver'
  | 'mesh'
  | 'nomsgall'
  | 'extudp'
  | 'bme'
  | 'bmp'
  | 'onewire';

type MeshcomStringField =
  'country' | 'maxv' | 'utcoff' | 'lat' | 'lon' | 'alt' | 'postime' | 'symid' | 'symcd' | 'ownip';

const SERIAL_ON_OFF_PATTERNS: readonly (readonly [MeshcomOnOffField, RegExp])[] = [
  ['display', /\.\.\.DISPLAY\s+(on|off)/i],
  ['mesh', /\.\.\.MESH\s+(on|off)/i],
  ['nomsgall', /\.\.\.NOMSGALL\s+(on|off)/i],
  ['button', /\.\.\.BUTTON\s+\(\d+\)\s+(on|off)/i],
  ['extudp', /\.\.\.EXTUDP\s+(on|off)/i],
  ['boost', /RXBOOST\s+(on|off)/i],
  ['gps', /\.\.\.GPS\s+(on|off)/i],
  ['track', /\.\.\.TRACK\s+(on|off)/i],
  ['gateway', /\.\.\.GATEWAY\s+(on|off)/i],
  ['webserver', /\.\.\.Webserver\s+(on|off)/i],
  ['bme', /\.\.\.BME\s+(on|off)/i],
  ['bmp', /\.\.\.BMP\s+(on|off)/i],
  ['onewire', /\.\.\.(?:ONEWIRE|OW)\s+(on|off)/i],
];

const SERIAL_STRING_PATTERNS: readonly (readonly [MeshcomStringField, readonly RegExp[]])[] = [
  ['country', [/\.\.\.CTRY\s+(\S+)/i]],
  ['maxv', [/MAXV\s+([\d.]+)/i]],
  ['utcoff', [/UTC-OFF\s+([+-]?\d+\.?\d*)/i]],
  ['lat', [/LAT\s+([+-]?\d+\.?\d*)/i, /\.\.\.LAT\s+([+-]?\d+\.?\d*)/i]],
  ['lon', [/LON\s+([+-]?\d+\.?\d*)/i, /\.\.\.LON\s+([+-]?\d+\.?\d*)/i]],
  ['alt', [/ALT\s+([+-]?\d+)/i, /\.\.\.ALT\s+([+-]?\d+)/i]],
  ['postime', [/POSTIME\s+(\d+)/i, /POS.?TIME\s+(\d+)/i]],
  ['symid', [/SYMID\s+([/\\])/i, /SYM.?ID\s+([/\\])/i]],
  ['symcd', [/SYMCD\s+(\S)/i, /SYM.?CD\s+(\S)/i]],
  ['ownip', [/OWNIP\s+(\d+\.\d+\.\d+\.\d+)/i, /IP:\s*(\d+\.\d+\.\d+\.\d+)/i]],
];

function firstCapture(text: string, patterns: readonly RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const value = pattern.exec(text)?.[1];
    if (value) return value;
  }
  return undefined;
}

function mergeMeshcomSerialIdentityText(accum: MeshcomDeviceSettingsAccum, text: string): void {
  const call = /\.\.\.Call:\s*<([^>]+)>/i.exec(text) ?? /Call:\s*<([^>]+)>/i.exec(text);
  if (call?.[1]) {
    const n = normalizeMeshcomCallsign(call[1]);
    if (n) accum.call = n;
  }
  const bt = /\.\.\.BTCODE\s+(\d+)/i.exec(text);
  if (bt?.[1]) accum.btCode = bt[1].padStart(6, '0').slice(-6);
  const ble = /\.\.\.BLE\s*:\s*(long|short)/i.exec(text);
  if (ble?.[1] === 'long' || ble?.[1] === 'short') accum.ble = ble[1];
}

function mergeMeshcomSerialRadioText(accum: MeshcomDeviceSettingsAccum, text: string): void {
  const freq = /FREQ\s+([\d.]+)\s*MHz\s+TXPWR\s+(-?\d+)/i.exec(text);
  if (freq?.[1]) accum.freqMhz = freq[1];
  if (freq?.[2]) accum.txPower = freq[2];
  // Full revision line: `4.40a (build: Nov 22 2026 / 14:30:00)` — not only the `\S+` token.
  const fw = /--MeshCom\s+([^\r\n]+)/i.exec(text);
  if (fw?.[1]) accum.fwver = fw[1].trim();
  const battV = /BATT\s+([\d.]+)\s*V/i.exec(text);
  if (battV?.[1]) {
    const n = Number.parseFloat(battV[1]);
    if (Number.isFinite(n)) accum.battVoltage = n;
  }
  const battPct = /BATT\s+(\d+)\s*%/i.exec(text);
  if (battPct?.[1]) {
    const n = Number.parseInt(battPct[1], 10);
    if (Number.isFinite(n)) accum.battPercent = n;
  }
}

function collectMeshcomSerialGroups(text: string): string {
  const groups: string[] = [];
  for (const m of text.matchAll(/GC-(\d+):(\d+)/gi)) {
    if (m[2] && m[2] !== '0') groups.push(m[2]);
  }
  return groups.join(';');
}

function mergeMeshcomSerialAprsText(accum: MeshcomDeviceSettingsAccum, text: string): void {
  const extip = /\.\.\.EXT IP\s+(\S+)/i.exec(text);
  if (extip?.[1] && extip[1] !== '...') accum.extudpip = extip[1];
  const atxt = /\.\.\.ATXT:\s*(.+)/i.exec(text)?.at(1)?.trim();
  if (atxt && atxt !== 'none') accum.aprscomment = atxt;
  const name = /\.\.\.NAME:\s*(.+)/i.exec(text)?.at(1)?.trim();
  if (name) accum.operatorName = name.slice(0, 19);
  const ssid = /\.\.\.SSID:\s*(\S+)/i.exec(text) ?? /SSID:\s*<([^>]+)>/i.exec(text);
  if (ssid?.[1] && ssid[1] !== 'none') accum.ssid = ssid[1];
  const groups = collectMeshcomSerialGroups(text);
  if (groups) accum.groups = groups;
}

/** Parse concatenated Serial `--info` console text into the accumulator. */
export function mergeMeshcomSerialInfoText(accum: MeshcomDeviceSettingsAccum, text: string): void {
  mergeMeshcomSerialIdentityText(accum, text);
  for (const [field, pattern] of SERIAL_ON_OFF_PATTERNS) {
    const value = pattern.exec(text)?.[1];
    if (value === 'on' || value === 'off') accum[field] = value;
  }
  for (const [field, patterns] of SERIAL_STRING_PATTERNS) {
    const value = firstCapture(text, patterns);
    if (value) accum[field] = value;
  }
  mergeMeshcomSerialRadioText(accum, text);
  mergeMeshcomSerialAprsText(accum, text);
}

/**
 * Parse Serial `--wx` console weather dump into the accumulator.
 * Format (ICSSW firmware): `TEMP: … °C`, `HUM: … %rH`, `QFE`/`QNH`, `GAS`, `eCO2`, `TOUT`.
 */
type MeshcomWxNumberField =
  'temperatureC' | 'temperatureOutC' | 'humidityPct' | 'pressureHpa' | 'gasResistance' | 'co2Ppm';

function assignFiniteNumber(
  accum: MeshcomDeviceSettingsAccum,
  field: MeshcomWxNumberField,
  raw: string | undefined,
): void {
  if (!raw) return;
  const n = Number.parseFloat(raw);
  if (Number.isFinite(n)) accum[field] = n;
}

function parseMeshcomWxPressure(text: string): string | undefined {
  return /QFE:\s*([+-]?\d+\.?\d*)/i.exec(text)?.[1] ?? /QNH:\s*([+-]?\d+\.?\d*)/i.exec(text)?.[1];
}

function parseMeshcomWxGasOhms(text: string): number | undefined {
  const gas = /GAS:\s*([+-]?\d+\.?\d*)\s*(kOhm|kohm|kΩ|Ohm|ohm|Ω)?/i.exec(text);
  if (!gas?.[1]) return undefined;
  const n = Number.parseFloat(gas[1]);
  if (!Number.isFinite(n)) return undefined;
  return gas[2] && /^k/i.test(gas[2]) ? n * 1000 : n;
}

export function mergeMeshcomSerialWxText(accum: MeshcomDeviceSettingsAccum, text: string): void {
  const fields: readonly (readonly [MeshcomWxNumberField, RegExp])[] = [
    ['temperatureC', /TEMP:\s*([+-]?\d+\.?\d*)/i],
    ['temperatureOutC', /TOUT:\s*([+-]?\d+\.?\d*)/i],
    ['humidityPct', /HUM:\s*([+-]?\d+\.?\d*)/i],
    ['co2Ppm', /e?CO2:\s*([+-]?\d+\.?\d*)/i],
  ];
  for (const [field, pattern] of fields) {
    assignFiniteNumber(accum, field, pattern.exec(text)?.[1]);
  }
  assignFiniteNumber(accum, 'pressureHpa', parseMeshcomWxPressure(text));
  const gas = parseMeshcomWxGasOhms(text);
  if (gas != null) accum.gasResistance = gas;
}

/** Map accumulator fields onto MeshCom Radio command ids. */
export function meshcomSettingsToCommandValues(
  accum: MeshcomDeviceSettingsAccum,
): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (id: string, v: string | undefined): void => {
    if (v != null && v !== '') out[id] = v;
  };
  put('setcall', accum.call);
  put('operatorname', accum.operatorName);
  put('setctry', accum.country);
  put('btcode', accum.btCode);
  put('ble', accum.ble);
  put('maxv', accum.maxv);
  put('rxboost', accum.boost);
  put('display', accum.display);
  put('button', accum.button);
  put('volt', accum.volt);
  put('proz', accum.volt === 'on' ? 'off' : accum.volt === 'off' ? 'on' : undefined);
  put('gps', accum.gps);
  put('track', accum.track);
  put('gateway', accum.gateway);
  put('webserver', accum.webserver);
  put('mesh', accum.mesh);
  put('nomsgall', accum.nomsgall);
  put('utcoff', accum.utcoff);
  put('postime', accum.postime);
  put('setlat', accum.lat);
  put('setlon', accum.lon);
  put('setalt', accum.alt);
  put('setssid', accum.ssid);
  put('setownip', accum.ownip);
  put('setowngw', accum.owngw);
  put('setownms', accum.ownms);
  put('extudp', accum.extudp);
  put('extudpip', accum.extudpip);
  put('wifiap', accum.wifiap);
  put('aprscomment', accum.aprscomment);
  put('symid', accum.symid);
  put('symcd', accum.symcd);
  put('setgrc', accum.groups);
  put('bme', accum.bme);
  put('bmp', accum.bmp);
  put('onewire', accum.onewire);
  return out;
}

export function snapshotMeshcomDeviceSettings(
  accum: MeshcomDeviceSettingsAccum,
  updatedAt = Date.now(),
  extras?: { mheard?: MeshcomDeviceSettingsSnapshot['mheard'] },
): MeshcomDeviceSettingsSnapshot {
  return {
    valuesByCommandId: meshcomSettingsToCommandValues(accum),
    callsign: accum.call ?? '',
    operatorName: accum.operatorName ?? '',
    countryCode: accum.country ?? '',
    firmwareVersion: formatMeshcomInstalledFirmware(accum.fwver, accum.buildDate) ?? undefined,
    batteryLevel: accum.battPercent,
    voltage: accum.battVoltage,
    temperatureC: accum.temperatureC,
    humidityPct: accum.humidityPct,
    pressureHpa: accum.pressureHpa,
    temperatureOutC: accum.temperatureOutC,
    gasResistance: accum.gasResistance,
    co2Ppm: accum.co2Ppm,
    mheard: extras?.mheard,
    complete: accum.complete,
    updatedAt,
  };
}

export function emptyMeshcomDeviceSettingsAccum(): MeshcomDeviceSettingsAccum {
  return { complete: false };
}

/** Listen-filter GRC ids from a settings snapshot (`--setgrc` / GCBn). */
export function meshcomListenGroupIdsFromSnapshot(
  snap: MeshcomDeviceSettingsSnapshot | null | undefined,
): number[] {
  if (!snap) return [];
  return parseMeshcomGrcListenList(snap.valuesByCommandId.setgrc);
}
