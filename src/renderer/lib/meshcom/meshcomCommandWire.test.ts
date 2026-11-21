import { describe, expect, it } from 'vitest';

import {
  buildMeshcomSettimeCommand,
  formatMeshcomSettimeUtc,
  normalizeMeshcomCommandInput,
  redactMeshcomCommandForLog,
} from './meshcomCommandWire';

describe('meshcomCommandWire', () => {
  it('formats UTC settime as yyyy.mm.dd hh:mm:ss', () => {
    const d = new Date(Date.UTC(2026, 10, 20, 14, 5, 9));
    expect(formatMeshcomSettimeUtc(d)).toBe('2026.11.20 14:05:09');
    expect(buildMeshcomSettimeCommand(d)).toBe('--settime 2026.11.20 14:05:09');
  });

  it('normalizes APP shortcuts and bare tokens', () => {
    expect(normalizeMeshcomCommandInput('GATEWAY')).toBe('--gateway');
    expect(normalizeMeshcomCommandInput('WX-Info')).toBe('--wx');
    expect(normalizeMeshcomCommandInput('--volt on')).toBe('--volt on');
    expect(normalizeMeshcomCommandInput('volt on')).toBe('--volt on');
  });

  it('redacts secrets', () => {
    expect(redactMeshcomCommandForLog('--setpwd secret')).toBe('--setpwd [redacted]');
  });
});
