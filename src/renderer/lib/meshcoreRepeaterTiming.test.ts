import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  beginMeshcoreRepeaterTiming,
  logMeshcoreRepeaterTimingSuccess,
  logMeshcoreRepeaterTimingTimeout,
  markMeshcoreRepeaterTimingPhase,
  resetMeshcoreRepeaterTimingSeqForTests,
} from './meshcoreRepeaterTiming';

describe('meshcoreRepeaterTiming', () => {
  afterEach(() => {
    resetMeshcoreRepeaterTimingSeqForTests();
    vi.restoreAllMocks();
  });

  it('records phases and logs success at debug', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const record = beginMeshcoreRepeaterTiming({ op: 'status', nodeId: 42, hops: 0 });
    markMeshcoreRepeaterTimingPhase(record, 'settle');
    markMeshcoreRepeaterTimingPhase(record, 'sent', { estTimeoutMs: 4000 });
    logMeshcoreRepeaterTimingSuccess(record);
    expect(debug).toHaveBeenCalledTimes(1);
    const line = String(debug.mock.calls[0]?.[0] ?? '');
    expect(line).toContain('ok');
    expect(line).toContain('op=status');
    expect(line).toContain('node=42');
    expect(line).toContain('est=4000');
  });

  it('logs timeout at warn without command bodies', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const record = beginMeshcoreRepeaterTiming({ op: 'neighbors', nodeId: 7, hops: 3 });
    logMeshcoreRepeaterTimingTimeout(record);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0] ?? '');
    expect(line).toContain('timeout');
    expect(line).not.toContain('password');
  });
});
