import { describe, expect, it } from 'vitest';

import type { DiagnosticRow } from '../types';
import { filterRetiredRfDiagnosticRows } from './diagnosticRows';

describe('filterRetiredRfDiagnosticRows', () => {
  it('drops Excessive Flooding RF rows and keeps other RF and routing rows', () => {
    const rows: DiagnosticRow[] = [
      {
        kind: 'rf',
        id: 'rf:1:excessive_flooding',
        nodeId: 1,
        condition: 'Excessive Flooding',
        cause: 'legacy',
        severity: 'warning',
        detectedAt: 1,
      },
      {
        kind: 'rf',
        id: 'rf:1:elevated_noise_floor',
        nodeId: 1,
        condition: 'Elevated Noise Floor',
        cause: 'noise',
        severity: 'warning',
        detectedAt: 1,
      },
      {
        kind: 'routing',
        id: 'routing:2',
        nodeId: 2,
        type: 'weak_link',
        severity: 'warning',
        description: 'path',
        detectedAt: 1,
      },
    ];
    const filtered = filterRetiredRfDiagnosticRows(rows);
    expect(filtered).toHaveLength(2);
    expect(filtered.some((r) => r.kind === 'rf' && r.condition === 'Excessive Flooding')).toBe(
      false,
    );
    expect(filtered.some((r) => r.kind === 'rf' && r.condition === 'Elevated Noise Floor')).toBe(
      true,
    );
    expect(filtered.some((r) => r.kind === 'routing')).toBe(true);
  });
});
