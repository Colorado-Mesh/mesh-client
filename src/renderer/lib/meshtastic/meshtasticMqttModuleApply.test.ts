import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  buildMeshtasticMqttModuleApplyValue,
  isDefaultMeshtasticMqttServer,
  meshtasticDeviceRequiresMqttProxyToClient,
  parseMeshtasticMqttAddressPort,
  stripMeshtasticProtobufMeta,
  validateMeshtasticMqttModuleApply,
} from './meshtasticMqttModuleApply';

const t = ((key: string) => key) as TFunction;

describe('meshtasticMqttModuleApply', () => {
  it('strips protobuf metadata', () => {
    expect(stripMeshtasticProtobufMeta({ $typeName: 'x', enabled: true })).toEqual({
      enabled: true,
    });
  });

  it('merges device-only fields into apply payload', () => {
    const value = buildMeshtasticMqttModuleApplyValue(
      {
        $typeName: 'meshtastic.ModuleConfig.MQTTConfig',
        enabled: false,
        address: 'broker.example.com',
        proxyToClientEnabled: true,
        mapReportingEnabled: true,
        mapReportSettings: { publishIntervalSecs: 3600, positionPrecision: 12 },
      },
      {
        enabled: true,
        address: 'broker.example.com',
        username: 'u',
        password: 'p',
        encryptionEnabled: true,
        jsonEnabled: false,
        tlsEnabled: false,
        root: 'msh',
        mapReportingEnabled: true,
        proxyToClientEnabled: true,
      },
    );

    expect(value.proxyToClientEnabled).toBe(true);
    expect(value.mapReportSettings).toEqual({
      publishIntervalSecs: 3600,
      positionPrecision: 12,
    });
    expect(value.enabled).toBe(true);
    expect(value).not.toHaveProperty('$typeName');
  });

  it('adds default mapReportSettings when enabling map reporting without device settings', () => {
    const value = buildMeshtasticMqttModuleApplyValue(
      { enabled: false },
      {
        enabled: true,
        address: 'broker.example.com',
        username: '',
        password: '',
        encryptionEnabled: false,
        jsonEnabled: false,
        tlsEnabled: false,
        root: '',
        mapReportingEnabled: true,
        proxyToClientEnabled: false,
      },
    );

    expect(value.mapReportSettings).toEqual({
      publishIntervalSecs: 0,
      positionPrecision: 10,
    });
  });

  it('detects default MQTT server', () => {
    expect(isDefaultMeshtasticMqttServer('')).toBe(true);
    expect(isDefaultMeshtasticMqttServer('mqtt.meshtastic.org')).toBe(true);
    expect(isDefaultMeshtasticMqttServer('broker.example.com')).toBe(false);
  });

  it('parses broker port suffix', () => {
    expect(parseMeshtasticMqttAddressPort('mqtt.example.com:8883')).toBe(8883);
    expect(parseMeshtasticMqttAddressPort('mqtt.example.com')).toBeUndefined();
  });

  it('rejects TLS on default public broker when enabling', () => {
    const err = validateMeshtasticMqttModuleApply(
      {
        enabled: true,
        address: 'mqtt.meshtastic.org',
        tlsEnabled: true,
        proxyToClientEnabled: false,
      },
      t,
    );
    expect(err).toBe('modulePanel.errors.mqttDefaultServerTls');
  });

  it('rejects non-standard port on default public broker when enabling', () => {
    const err = validateMeshtasticMqttModuleApply(
      {
        enabled: true,
        address: 'mqtt.meshtastic.org:9000',
        tlsEnabled: false,
        proxyToClientEnabled: false,
      },
      t,
    );
    expect(err).toBe('modulePanel.errors.mqttDefaultServerPort');
  });

  it('requires address when enabling', () => {
    const err = validateMeshtasticMqttModuleApply({ enabled: true, address: '' }, t);
    expect(err).toBe('modulePanel.errors.mqttAddressRequired');
  });

  it('allows disable without address', () => {
    expect(validateMeshtasticMqttModuleApply({ enabled: false, address: '' }, t)).toBeNull();
  });

  it('detects radios without native IP networking', () => {
    expect(meshtasticDeviceRequiresMqttProxyToClient({ hasWifi: false, hasEthernet: false })).toBe(
      true,
    );
    expect(meshtasticDeviceRequiresMqttProxyToClient({ hasWifi: true, hasEthernet: false })).toBe(
      false,
    );
    expect(meshtasticDeviceRequiresMqttProxyToClient(undefined)).toBe(false);
  });

  it('auto-enables proxy when enabling MQTT on a radio without native networking', () => {
    const value = buildMeshtasticMqttModuleApplyValue(
      { enabled: false, proxyToClientEnabled: false },
      {
        enabled: true,
        address: 'broker.example.com',
        username: '',
        password: '',
        encryptionEnabled: false,
        jsonEnabled: false,
        tlsEnabled: false,
        root: '',
        mapReportingEnabled: false,
        proxyToClientEnabled: false,
      },
      { hasWifi: false, hasEthernet: false },
    );
    expect(value.proxyToClientEnabled).toBe(true);
  });

  it('requires proxy when metadata says no native network', () => {
    const err = validateMeshtasticMqttModuleApply(
      {
        enabled: true,
        address: 'broker.example.com',
        proxyToClientEnabled: false,
      },
      t,
      { hasWifi: false, hasEthernet: false },
    );
    expect(err).toBe('modulePanel.errors.mqttProxyRequired');
  });
});
