import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  logReticulumSidecarStderrLine,
  ReticulumSidecarStderrDedupe,
} from './reticulumSidecarStderrLog';

describe('ReticulumSidecarStderrDedupe', () => {
  let dedupe: ReticulumSidecarStderrDedupe;

  beforeEach(() => {
    dedupe = new ReticulumSidecarStderrDedupe();
  });

  it('passes non-beacon stderr through as warn', () => {
    expect(dedupe.decide('sidecar started')).toEqual({
      level: 'warn',
      message: 'sidecar started',
    });
  });

  it('rate-limits beacon TX failure lines to one warn per minute', () => {
    const line = 'auto: beacon TX failed iface=utun0';
    expect(dedupe.decide(line, 0).level).toBe('warn');
    expect(dedupe.decide(line, 1000).level).toBe('debug');
    expect(dedupe.decide(line, 2000).level).toBe('debug');
    const summary = dedupe.decide(line, 60_001);
    expect(summary.level).toBe('warn');
    expect(summary.message).toContain('suppressed 2 similar');
  });

  it('routes decision to warn/debug sinks', () => {
    const warn = vi.fn();
    const debug = vi.fn();
    logReticulumSidecarStderrLine('auto: beacon TX failed', dedupe, { warn, debug }, undefined, 0);
    logReticulumSidecarStderrLine(
      'auto: beacon TX failed',
      dedupe,
      { warn, debug },
      undefined,
      1000,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledTimes(1);
  });
});
