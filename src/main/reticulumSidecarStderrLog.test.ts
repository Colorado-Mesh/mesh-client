import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  logReticulumSidecarStderrLine,
  resolveSidecarRustLog,
  ReticulumSidecarStderrDedupe,
  shouldForwardReticulumSidecarStdout,
  SIDECAR_DEFAULT_RUST_LOG,
} from './reticulumSidecarStderrLog';

describe('shouldForwardReticulumSidecarStdout', () => {
  it('forwards WARN and ERROR tracing lines', () => {
    expect(
      shouldForwardReticulumSidecarStdout(
        '2026-07-30T11:23:18Z \u001b[33m WARN \u001b[0m auto: failed to select multicast',
      ),
    ).toBe(true);
    expect(shouldForwardReticulumSidecarStdout('ERROR panic in link_manager')).toBe(true);
  });

  it('drops INFO and DEBUG packet-routing spam', () => {
    expect(
      shouldForwardReticulumSidecarStdout(
        '\u001b[32m INFO \u001b[0m rns_transport::actor::inbound : data packet routing',
      ),
    ).toBe(false);
    expect(shouldForwardReticulumSidecarStdout('DEBUG resource part received')).toBe(false);
    expect(
      shouldForwardReticulumSidecarStdout('INFO parser received WARN and ERROR payload tokens'),
    ).toBe(false);
  });

  it('forwards INFO lines for PN triage targets', () => {
    expect(
      shouldForwardReticulumSidecarStdout(
        '2026-08-20T15:35:19Z INFO propagation-sync: settling after LXMF announce',
      ),
    ).toBe(true);
    expect(
      shouldForwardReticulumSidecarStdout(
        'INFO target=propagation-deposit message accepted stamped blob',
      ),
    ).toBe(true);
    expect(
      shouldForwardReticulumSidecarStdout('INFO target=lxmf-outbound LXMF advancing PN cascade'),
    ).toBe(true);
    expect(
      shouldForwardReticulumSidecarStdout(
        'INFO target=propagation-retrieve pn_hash=abc client /get stalled while establishing',
      ),
    ).toBe(true);
  });

  it('does not forward INFO when PN markers appear only in message text', () => {
    expect(
      shouldForwardReticulumSidecarStdout(
        'INFO reticulum_sidecar::stack::other: user said propagation-sync failed',
      ),
    ).toBe(false);
    expect(
      shouldForwardReticulumSidecarStdout(
        'INFO reticulum_sidecar::stack::lxmf_delivery: Propagation sync: announce settle',
      ),
    ).toBe(false);
  });
});

describe('resolveSidecarRustLog', () => {
  it('defaults to warn', () => {
    expect(resolveSidecarRustLog({})).toBe(SIDECAR_DEFAULT_RUST_LOG);
  });

  it('honors MESH_CLIENT_RUST_LOG over RUST_LOG', () => {
    expect(
      resolveSidecarRustLog({
        MESH_CLIENT_RUST_LOG: 'info',
        RUST_LOG: 'debug',
      }),
    ).toBe('info');
  });

  it('honors RUST_LOG when mesh override unset', () => {
    expect(resolveSidecarRustLog({ RUST_LOG: 'reticulum=debug' })).toBe('reticulum=debug');
  });
});

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
