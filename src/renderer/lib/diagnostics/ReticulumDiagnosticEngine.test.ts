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
});
