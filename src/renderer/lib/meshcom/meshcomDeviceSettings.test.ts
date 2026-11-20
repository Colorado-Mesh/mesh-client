import { describe, expect, it } from 'vitest';

import {
  emptyMeshcomDeviceSettingsAccum,
  mergeMeshcomBleSettingsJson,
  mergeMeshcomSerialInfoText,
  mergeMeshcomSerialWxText,
  meshcomSettingsToCommandValues,
  snapshotMeshcomDeviceSettings,
} from './meshcomDeviceSettings';

describe('meshcomDeviceSettings', () => {
  it('merges BLE TYP I / SN / SA into command values and CONFFIN', () => {
    const accum = emptyMeshcomDeviceSettingsAccum();
    expect(
      mergeMeshcomBleSettingsJson(accum, {
        TYP: 'I',
        CALL: 'oe1abc-12',
        CTRY: 'EU',
        BPIN: 123456,
        BLE: 'short',
        GCB0: 232,
        GCB1: 0,
      }).confFin,
    ).toBe(false);
    mergeMeshcomBleSettingsJson(accum, {
      TYP: 'SN',
      GPS: true,
      DISP: false,
      GW: false,
      NOALL: true,
      TXP: 14,
      MQRG: 433.175,
    });
    mergeMeshcomBleSettingsJson(accum, {
      TYP: 'I',
      CALL: 'oe1abc-12',
      BATP: 87,
      BATV: 4.12,
    });
    mergeMeshcomBleSettingsJson(accum, {
      TYP: 'W',
      TEMP: 21.5,
      HUM: 48,
      PRES: 1013.2,
      GAS: 120000,
      CO2: 410,
    });
    mergeMeshcomBleSettingsJson(accum, {
      TYP: 'SA',
      NAME: 'Alice',
      ATXT: 'mesh test',
      SYMID: '/',
      SYMCD: '#',
    });
    expect(mergeMeshcomBleSettingsJson(accum, { TYP: 'CONFFIN' }).confFin).toBe(true);
    expect(accum.complete).toBe(true);
    expect(accum.call).toBe('OE1ABC-12');
    expect(accum.operatorName).toBe('Alice');
    expect(accum.display).toBe('on');
    expect(accum.gps).toBe('on');
    expect(accum.nomsgall).toBe('on');
    expect(accum.battPercent).toBe(87);
    expect(accum.battVoltage).toBe(4.12);
    expect(accum.temperatureC).toBe(21.5);
    expect(accum.humidityPct).toBe(48);
    expect(accum.pressureHpa).toBe(1013.2);
    const values = meshcomSettingsToCommandValues(accum);
    expect(values.setcall).toBe('OE1ABC-12');
    expect(values.btcode).toBe('123456');
    expect(values.setgrc).toBe('232');
    expect(values.aprscomment).toBe('mesh test');
    const snap = snapshotMeshcomDeviceSettings(accum, 42);
    expect(snap.countryCode).toBe('EU');
    expect(snap.batteryLevel).toBe(87);
    expect(snap.voltage).toBe(4.12);
    expect(snap.temperatureC).toBe(21.5);
    expect(snap.updatedAt).toBe(42);
  });

  it('parses serial --info console text', () => {
    const accum = emptyMeshcomDeviceSettingsAccum();
    mergeMeshcomSerialInfoText(
      accum,
      [
        '--MeshCom 4.35p (build: Mar 20 2026)',
        '...Call: <DH1FR-1> ...ID 00AABBCC ...UTC-OFF 1.0 [GPS]',
        '...NOMSGALL off ...MESH on ...BUTTON (0) on',
        '...BTCODE 654321',
        '...ATXT: club mesh',
        '...NAME: Bob',
        '...BLE : long',
        '...DISPLAY on',
        '...CTRY AT',
        '...FREQ 433.1750 MHz TXPWR 20 dBm RXBOOST on',
        '...EXTUDP on ...EXT IP 192.168.1.10',
        '...SSID: MeshClub',
        'OWNIP 192.168.1.42',
        'LAT 48.2082 LON 16.3738 ALT 200',
        'POSTIME 300',
        '...BME on ...BMP off ...ONEWIRE on',
        'SYMID / SYMCD #',
        'BATT 3.95 V  BATT 72 %',
        'GC-1:232 GC-2:20',
      ].join('\n'),
    );
    expect(accum.call).toBe('DH1FR-1');
    expect(accum.country).toBe('AT');
    expect(accum.btCode).toBe('654321');
    expect(accum.operatorName).toBe('Bob');
    expect(accum.mesh).toBe('on');
    expect(accum.display).toBe('on');
    expect(accum.extudp).toBe('on');
    expect(accum.extudpip).toBe('192.168.1.10');
    expect(accum.ssid).toBe('MeshClub');
    expect(accum.ownip).toBe('192.168.1.42');
    expect(accum.lat).toBe('48.2082');
    expect(accum.lon).toBe('16.3738');
    expect(accum.alt).toBe('200');
    expect(accum.postime).toBe('300');
    expect(accum.bme).toBe('on');
    expect(accum.bmp).toBe('off');
    expect(accum.onewire).toBe('on');
    expect(accum.symid).toBe('/');
    expect(accum.symcd).toBe('#');
    expect(accum.boost).toBe('on');
    expect(accum.ble).toBe('long');
    expect(accum.groups).toBe('232;20');
    expect(accum.txPower).toBe('20');
    expect(accum.battVoltage).toBe(3.95);
    expect(accum.battPercent).toBe(72);
  });

  it('parses serial --wx weather dump', () => {
    const accum = emptyMeshcomDeviceSettingsAccum();
    mergeMeshcomSerialWxText(
      accum,
      [
        'TEMP: 22.3 °C',
        'TOUT: 19.1 °C',
        'HUM: 51.0 %rH',
        'QFE: 1008.5 hPa',
        'QNH: 1015.0 hPa',
        'GAS: 45.0 kOhm',
        'eCO2: 420 ppm',
      ].join('\n'),
    );
    expect(accum.temperatureC).toBe(22.3);
    expect(accum.temperatureOutC).toBe(19.1);
    expect(accum.humidityPct).toBe(51);
    expect(accum.pressureHpa).toBe(1008.5);
    expect(accum.gasResistance).toBe(45_000);
    expect(accum.co2Ppm).toBe(420);
  });
});
