/**
 * Parse MeshCom node settings from BLE companion JSON (`TYP` packets after `{HELLO}`)
 * and Serial `--info` text, then map them onto Radio command field values.
 *
 * BLE field names follow ICSSW firmware `command_functions.cpp` (`sendInfo` / `sendNodeSetting` /
 * `sendWifiSetting` / `sendGpsJson` / `sendAPRSset`).
 */

import { normalizeMeshcomCallsign } from './meshcomCallsign';

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

  switch (typ) {
    case 'I': {
      const call = asString(doc.CALL);
      if (call) accum.call = normalizeMeshcomCallsign(call) || call;
      const ctry = asString(doc.CTRY);
      if (ctry) accum.country = ctry;
      const bpin = asString(doc.BPIN);
      if (bpin != null) accum.btCode = bpin.padStart(6, '0').slice(-6);
      const ble = asString(doc.BLE);
      if (ble === 'long' || ble === 'short') accum.ble = ble;
      const maxv = asString(doc.MAXV);
      if (maxv) accum.maxv = maxv;
      const boost = onOff(doc.BOOST);
      if (boost) accum.boost = boost;
      const fw = asString(doc.FWVER);
      if (fw) accum.fwver = fw;
      const batp = asFiniteNumber(doc.BATP);
      if (batp != null) accum.battPercent = batp;
      const batv = asFiniteNumber(doc.BATV);
      if (batv != null) accum.battVoltage = batv;
      const groups: string[] = [];
      for (let i = 0; i < 6; i++) {
        const g = asString(doc[`GCB${i}`]);
        if (g && g !== '0') groups.push(g);
      }
      if (groups.length > 0) accum.groups = groups.join(';');
      break;
    }
    case 'W': {
      const temp = asFiniteNumber(doc.TEMP);
      if (temp != null) accum.temperatureC = temp;
      const tout = asFiniteNumber(doc.TOUT);
      if (tout != null) accum.temperatureOutC = tout;
      const hum = asFiniteNumber(doc.HUM);
      if (hum != null) accum.humidityPct = hum;
      const press = asFiniteNumber(doc.PRES) ?? asFiniteNumber(doc.QNH);
      if (press != null) accum.pressureHpa = press;
      const gas = asFiniteNumber(doc.GAS);
      if (gas != null) accum.gasResistance = gas;
      const co2 = asFiniteNumber(doc.CO2);
      if (co2 != null) accum.co2Ppm = co2;
      break;
    }
    case 'SN': {
      const gw = onOff(doc.GW);
      if (gw) accum.gateway = gw;
      const ws = onOff(doc.WS);
      if (ws) accum.webserver = ws;
      const disp = boolToDisplayOn(doc.DISP);
      if (disp) accum.display = disp;
      const btn = onOff(doc.BTN);
      if (btn) accum.button = btn;
      const msh = onOff(doc.MSH);
      if (msh) accum.mesh = msh;
      const gps = onOff(doc.GPS);
      if (gps) accum.gps = gps;
      const track = onOff(doc.TRACK);
      if (track) accum.track = track;
      const utc = asString(doc.UTCOF);
      if (utc) accum.utcoff = utc;
      const txp = asString(doc.TXP);
      if (txp) accum.txPower = txp;
      const qrg = asString(doc.MQRG);
      if (qrg) accum.freqMhz = qrg;
      const noall = onOff(doc.NOALL);
      if (noall) accum.nomsgall = noall;
      break;
    }
    case 'SN1': {
      const volt = onOff(doc.VOLT);
      if (volt) accum.volt = volt;
      break;
    }
    case 'SW': {
      const ssid = asString(doc.SSID);
      if (ssid) accum.ssid = ssid;
      const ap = onOff(doc.AP);
      if (ap) accum.wifiap = ap;
      break;
    }
    case 'S2': {
      const ownip = asString(doc.OWNIP);
      if (ownip) accum.ownip = ownip;
      const owngw = asString(doc.OWNGW);
      if (owngw) accum.owngw = owngw;
      const ownms = asString(doc.OWNMS);
      if (ownms) accum.ownms = ownms;
      const eudp = onOff(doc.EUDP);
      if (eudp) accum.extudp = eudp;
      const eudpip = asString(doc.EUDPIP);
      if (eudpip) accum.extudpip = eudpip;
      break;
    }
    case 'G': {
      const lat = asString(doc.LAT);
      if (lat) accum.lat = lat;
      const lon = asString(doc.LON);
      if (lon) accum.lon = lon;
      const alt = asString(doc.ALT);
      if (alt) accum.alt = alt;
      const rate = asString(doc.RATE);
      if (rate) accum.postime = rate;
      break;
    }
    case 'SA': {
      const atxt = asString(doc.ATXT);
      if (atxt && atxt !== 'none') accum.aprscomment = atxt;
      const name = asString(doc.NAME);
      if (name) accum.operatorName = name.slice(0, 19);
      const symid = asString(doc.SYMID);
      if (symid) accum.symid = symid;
      const symcd = asString(doc.SYMCD);
      if (symcd) accum.symcd = symcd;
      break;
    }
    case 'SE': {
      const bme = onOff(doc.BME);
      if (bme) accum.bme = bme;
      const bmp = onOff(doc.BMP);
      if (bmp) accum.bmp = bmp;
      const ow = onOff(doc.OW);
      if (ow) accum.onewire = ow;
      break;
    }
    default:
      break;
  }
  return { confFin: false };
}

/** Parse concatenated Serial `--info` console text into the accumulator. */
export function mergeMeshcomSerialInfoText(accum: MeshcomDeviceSettingsAccum, text: string): void {
  const call = /\.\.\.Call:\s*<([^>]+)>/i.exec(text) ?? /Call:\s*<([^>]+)>/i.exec(text);
  if (call?.[1]) {
    const n = normalizeMeshcomCallsign(call[1]);
    if (n) accum.call = n;
  }
  const ctry = /\.\.\.CTRY\s+(\S+)/i.exec(text);
  if (ctry?.[1]) accum.country = ctry[1];
  const bt = /\.\.\.BTCODE\s+(\d+)/i.exec(text);
  if (bt?.[1]) accum.btCode = bt[1].padStart(6, '0').slice(-6);
  const ble = /\.\.\.BLE\s*:\s*(long|short)/i.exec(text);
  if (ble?.[1] === 'long' || ble?.[1] === 'short') accum.ble = ble[1];
  const display = /\.\.\.DISPLAY\s+(on|off)/i.exec(text);
  if (display?.[1] === 'on' || display?.[1] === 'off') accum.display = display[1];
  const mesh = /\.\.\.MESH\s+(on|off)/i.exec(text);
  if (mesh?.[1] === 'on' || mesh?.[1] === 'off') accum.mesh = mesh[1];
  const nomsg = /\.\.\.NOMSGALL\s+(on|off)/i.exec(text);
  if (nomsg?.[1] === 'on' || nomsg?.[1] === 'off') accum.nomsgall = nomsg[1];
  const button = /\.\.\.BUTTON\s+\(\d+\)\s+(on|off)/i.exec(text);
  if (button?.[1] === 'on' || button?.[1] === 'off') accum.button = button[1];
  const extudp = /\.\.\.EXTUDP\s+(on|off)/i.exec(text);
  if (extudp?.[1] === 'on' || extudp?.[1] === 'off') accum.extudp = extudp[1];
  const extip = /\.\.\.EXT IP\s+(\S+)/i.exec(text);
  if (extip?.[1] && extip[1] !== '...') accum.extudpip = extip[1];
  const utc = /UTC-OFF\s+([+-]?\d+\.?\d*)/i.exec(text);
  if (utc?.[1]) accum.utcoff = utc[1];
  const atxt = /\.\.\.ATXT:\s*(.+)/i.exec(text);
  if (atxt?.[1]) {
    const v = atxt[1].trim();
    if (v && v !== 'none') accum.aprscomment = v;
  }
  const name = /\.\.\.NAME:\s*(.+)/i.exec(text);
  if (name?.[1]) {
    const v = name[1].trim();
    if (v) accum.operatorName = v.slice(0, 19);
  }
  const freq = /FREQ\s+([\d.]+)\s*MHz\s+TXPWR\s+(-?\d+)/i.exec(text);
  if (freq?.[1]) accum.freqMhz = freq[1];
  if (freq?.[2]) accum.txPower = freq[2];
  const boost = /RXBOOST\s+(on|off)/i.exec(text);
  if (boost?.[1] === 'on' || boost?.[1] === 'off') accum.boost = boost[1];
  const gps = /\.\.\.GPS\s+(on|off)/i.exec(text);
  if (gps?.[1] === 'on' || gps?.[1] === 'off') accum.gps = gps[1];
  const track = /\.\.\.TRACK\s+(on|off)/i.exec(text);
  if (track?.[1] === 'on' || track?.[1] === 'off') accum.track = track[1];
  const gateway = /\.\.\.GATEWAY\s+(on|off)/i.exec(text);
  if (gateway?.[1] === 'on' || gateway?.[1] === 'off') accum.gateway = gateway[1];
  const web = /\.\.\.Webserver\s+(on|off)/i.exec(text);
  if (web?.[1] === 'on' || web?.[1] === 'off') accum.webserver = web[1];
  const maxv = /MAXV\s+([\d.]+)/i.exec(text);
  if (maxv?.[1]) accum.maxv = maxv[1];
  const fw = /--MeshCom\s+(\S+)/i.exec(text);
  if (fw?.[1]) accum.fwver = fw[1];
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

  const ssid = /\.\.\.SSID:\s*(\S+)/i.exec(text) ?? /SSID:\s*<([^>]+)>/i.exec(text);
  if (ssid?.[1] && ssid[1] !== 'none') accum.ssid = ssid[1];
  const ownip =
    /OWNIP\s+(\d+\.\d+\.\d+\.\d+)/i.exec(text) ?? /IP:\s*(\d+\.\d+\.\d+\.\d+)/i.exec(text);
  if (ownip?.[1]) accum.ownip = ownip[1];
  const lat = /LAT\s+([+-]?\d+\.?\d*)/i.exec(text) ?? /\.\.\.LAT\s+([+-]?\d+\.?\d*)/i.exec(text);
  if (lat?.[1]) accum.lat = lat[1];
  const lon = /LON\s+([+-]?\d+\.?\d*)/i.exec(text) ?? /\.\.\.LON\s+([+-]?\d+\.?\d*)/i.exec(text);
  if (lon?.[1]) accum.lon = lon[1];
  const alt = /ALT\s+([+-]?\d+)/i.exec(text) ?? /\.\.\.ALT\s+([+-]?\d+)/i.exec(text);
  if (alt?.[1]) accum.alt = alt[1];
  const postime = /POSTIME\s+(\d+)/i.exec(text) ?? /POS.?TIME\s+(\d+)/i.exec(text);
  if (postime?.[1]) accum.postime = postime[1];
  const bme = /\.\.\.BME\s+(on|off)/i.exec(text);
  if (bme?.[1] === 'on' || bme?.[1] === 'off') accum.bme = bme[1];
  const bmp = /\.\.\.BMP\s+(on|off)/i.exec(text);
  if (bmp?.[1] === 'on' || bmp?.[1] === 'off') accum.bmp = bmp[1];
  const ow = /\.\.\.ONEWIRE\s+(on|off)/i.exec(text) ?? /\.\.\.OW\s+(on|off)/i.exec(text);
  if (ow?.[1] === 'on' || ow?.[1] === 'off') accum.onewire = ow[1];
  const symid = /SYMID\s+([/\\])/i.exec(text) ?? /SYM.?ID\s+([/\\])/i.exec(text);
  if (symid?.[1]) accum.symid = symid[1];
  const symcd = /SYMCD\s+(\S)/i.exec(text) ?? /SYM.?CD\s+(\S)/i.exec(text);
  if (symcd?.[1]) accum.symcd = symcd[1];

  const groups: string[] = [];
  for (const m of text.matchAll(/GC-(\d+):(\d+)/gi)) {
    if (m[2] && m[2] !== '0') groups.push(m[2]);
  }
  if (groups.length > 0) accum.groups = groups.join(';');
}

/**
 * Parse Serial `--wx` console weather dump into the accumulator.
 * Format (ICSSW firmware): `TEMP: … °C`, `HUM: … %rH`, `QFE`/`QNH`, `GAS`, `eCO2`, `TOUT`.
 */
export function mergeMeshcomSerialWxText(accum: MeshcomDeviceSettingsAccum, text: string): void {
  const temp = /TEMP:\s*([+-]?\d+\.?\d*)/i.exec(text);
  if (temp?.[1]) {
    const n = Number.parseFloat(temp[1]);
    if (Number.isFinite(n)) accum.temperatureC = n;
  }
  const tout = /TOUT:\s*([+-]?\d+\.?\d*)/i.exec(text);
  if (tout?.[1]) {
    const n = Number.parseFloat(tout[1]);
    if (Number.isFinite(n)) accum.temperatureOutC = n;
  }
  const hum = /HUM:\s*([+-]?\d+\.?\d*)/i.exec(text);
  if (hum?.[1]) {
    const n = Number.parseFloat(hum[1]);
    if (Number.isFinite(n)) accum.humidityPct = n;
  }
  const qfe = /QFE:\s*([+-]?\d+\.?\d*)/i.exec(text);
  const qnh = /QNH:\s*([+-]?\d+\.?\d*)/i.exec(text);
  if (qfe?.[1]) {
    const n = Number.parseFloat(qfe[1]);
    if (Number.isFinite(n)) accum.pressureHpa = n;
  } else if (qnh?.[1]) {
    const n = Number.parseFloat(qnh[1]);
    if (Number.isFinite(n)) accum.pressureHpa = n;
  }
  const gas = /GAS:\s*([+-]?\d+\.?\d*)\s*(kOhm|kohm|kΩ|Ohm|ohm|Ω)?/i.exec(text);
  if (gas?.[1]) {
    let n = Number.parseFloat(gas[1]);
    if (Number.isFinite(n)) {
      if (gas[2] && /^k/i.test(gas[2])) n *= 1000;
      accum.gasResistance = n;
    }
  }
  const co2 = /e?CO2:\s*([+-]?\d+\.?\d*)/i.exec(text);
  if (co2?.[1]) {
    const n = Number.parseFloat(co2[1]);
    if (Number.isFinite(n)) accum.co2Ppm = n;
  }
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
