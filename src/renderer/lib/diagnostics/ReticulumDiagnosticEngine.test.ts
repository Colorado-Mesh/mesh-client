import { describe, expect, it } from 'vitest';

import { buildReticulumDiagnosticRows } from './ReticulumDiagnosticEngine';

describe('ReticulumDiagnosticEngine', () => {
  it('flags disabled RNS/LXMF and down interfaces', () => {
    const rows = buildReticulumDiagnosticRows({
      rns_ready: false,
      lxmf_ready: false,
      interface_count: 1,
      peer_count: 0,
      interfaces: [
        {
          id: 'tcp-1',
          name: 'Hub',
          type: 'tcp',
          enabled: true,
          status: 'down',
        },
      ],
    });
    expect(rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/rns-not-ready')).toBe(
      true,
    );
    expect(rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/interface-down')).toBe(
      true,
    );
  });

  it('flags stale local serial port separately from generic interface-down', () => {
    const rows = buildReticulumDiagnosticRows(
      {
        rns_ready: true,
        lxmf_ready: true,
        interface_count: 1,
        peer_count: 1,
        interfaces: [
          {
            id: 'heltec',
            name: 'Heltec V3',
            type: 'rnode',
            enabled: true,
            status: 'down',
            serial_port: '/dev/cu.usbserial-7',
          },
        ],
      },
      {
        interfaces: [
          {
            id: 'heltec',
            name: 'Heltec V3',
            type: 'rnode',
            enabled: true,
            status: 'down',
            serial_port: '/dev/cu.usbserial-7',
          },
        ],
        osSerialPorts: ['/dev/cu.usbserial-0001'],
      },
    );
    expect(rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/local-stale-port')).toBe(
      true,
    );
    expect(rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/interface-down')).toBe(
      false,
    );
  });
});
