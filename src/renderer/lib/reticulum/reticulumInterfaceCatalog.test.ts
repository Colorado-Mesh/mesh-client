import { describe, expect, it } from 'vitest';

import {
  RETICULUM_IFACE_UI_TYPES,
  RETICULUM_INTERFACE_CATALOG,
  reticulumCatalogEntry,
  reticulumCatalogFields,
  validateReticulumCatalogField,
} from '@/renderer/lib/reticulum/reticulumInterfaceCatalog';

/**
 * Config `type =` names accepted by the upstream factory `synthesize_interface`
 * (.rsstack/rsReticulum/crates/rns-runtime/src/interface_factory.rs). Kept in
 * lockstep with `UPSTREAM_FACTORY_TYPES` in the sidecar catalog test.
 */
const UPSTREAM_FACTORY_TYPES = [
  'TCPClientInterface',
  'TCPServerInterface',
  'UDPInterface',
  'SerialInterface',
  'KISSInterface',
  'AutoInterface',
  'RNodeInterface',
  'LocalInterface',
  'I2PInterface',
  'PipeInterface',
  'RNodeMultiInterface',
  'AX25KISSInterface',
  'BackboneInterface',
];

/** mesh-client spawns this itself from live.rs; upstream has no config type name. */
const MESH_CLIENT_SPAWNED_TYPES = ['BlePeerInterface'];

describe('reticulumInterfaceCatalog', () => {
  it('exposes every configured type', () => {
    expect(RETICULUM_IFACE_UI_TYPES.length).toBeGreaterThan(0);
    for (const type of RETICULUM_IFACE_UI_TYPES) {
      expect(reticulumCatalogEntry(type)).not.toBeNull();
    }
  });

  it('only uses config types a factory arm accepts', () => {
    for (const type of RETICULUM_IFACE_UI_TYPES) {
      const entry = reticulumCatalogEntry(type);
      expect(entry).not.toBeNull();
      const configType = entry?.configType ?? '';
      expect(
        UPSTREAM_FACTORY_TYPES.includes(configType) ||
          MESH_CLIENT_SPAWNED_TYPES.includes(configType),
      ).toBe(true);
    }
  });

  it('keeps config types unique', () => {
    const seen = new Set<string>();
    for (const type of RETICULUM_IFACE_UI_TYPES) {
      const configType = reticulumCatalogEntry(type)?.configType ?? '';
      expect(seen.has(configType)).toBe(false);
      seen.add(configType);
    }
  });

  it('preserves the nine legacy types', () => {
    for (const legacy of [
      'auto',
      'tcp',
      'udp',
      'i2p',
      'rnode',
      'rnode_multi',
      'kiss',
      'pipe',
      'ble_peer',
    ]) {
      expect(reticulumCatalogEntry(legacy)).not.toBeNull();
    }
  });

  it('adds serial, ax25kiss and local', () => {
    expect(RETICULUM_INTERFACE_CATALOG.serial.configType).toBe('SerialInterface');
    expect(RETICULUM_INTERFACE_CATALOG.ax25kiss.configType).toBe('AX25KISSInterface');
    expect(RETICULUM_INTERFACE_CATALOG.local.configType).toBe('LocalInterface');
  });

  it('only sets a flow-control default on types that support it', () => {
    for (const type of RETICULUM_IFACE_UI_TYPES) {
      const entry = reticulumCatalogEntry(type);
      if (entry?.defaultFlowControl != null) {
        expect(entry.supportsFlowControl).toBe(true);
      }
    }
  });

  it('leaves bespoke-UI types without generic fields', () => {
    for (const type of ['tcp', 'udp', 'i2p', 'rnode', 'rnode_multi', 'kiss', 'pipe', 'ble_peer']) {
      expect(reticulumCatalogFields(type)).toHaveLength(0);
    }
  });

  it('requires a serial port for serial and ax25kiss', () => {
    for (const type of ['serial', 'ax25kiss']) {
      const port = reticulumCatalogFields(type).find((f) => f.key === 'port');
      expect(port?.kind).toBe('serialPort');
      expect(port?.required).toBe(true);
      expect(port?.bind).toBe('serial_port');
    }
  });

  describe('validateReticulumCatalogField', () => {
    const ssid = { key: 'ssid', kind: 'number' as const, required: true, min: 0, max: 15 };

    it('rejects an empty required field', () => {
      expect(validateReticulumCatalogField(ssid, '  ')).toBe(
        'connectionPanel.reticulumInterfaces.fieldRequired',
      );
    });

    it('accepts an empty optional field', () => {
      expect(validateReticulumCatalogField({ key: 'speed', kind: 'number' }, '')).toBeNull();
    });

    it('rejects non-numeric input', () => {
      expect(validateReticulumCatalogField(ssid, 'abc')).toBe(
        'connectionPanel.reticulumInterfaces.fieldNotANumber',
      );
    });

    it('enforces the ssid range', () => {
      expect(validateReticulumCatalogField(ssid, '0')).toBeNull();
      expect(validateReticulumCatalogField(ssid, '15')).toBeNull();
      expect(validateReticulumCatalogField(ssid, '16')).toBe(
        'connectionPanel.reticulumInterfaces.fieldOutOfRange',
      );
      expect(validateReticulumCatalogField(ssid, '-1')).toBe(
        'connectionPanel.reticulumInterfaces.fieldOutOfRange',
      );
    });

    it('enforces maxLength', () => {
      const callsign = { key: 'callsign', kind: 'text' as const, maxLength: 6 };
      expect(validateReticulumCatalogField(callsign, 'KD5IHC')).toBeNull();
      expect(validateReticulumCatalogField(callsign, 'TOOLONG')).toBe(
        'connectionPanel.reticulumInterfaces.fieldTooLong',
      );
    });

    it('enforces select options', () => {
      const parity = { key: 'parity', kind: 'select' as const, options: ['N', 'E', 'O'] };
      expect(validateReticulumCatalogField(parity, 'E')).toBeNull();
      expect(validateReticulumCatalogField(parity, 'X')).toBe(
        'connectionPanel.reticulumInterfaces.fieldInvalidOption',
      );
    });
  });
});
