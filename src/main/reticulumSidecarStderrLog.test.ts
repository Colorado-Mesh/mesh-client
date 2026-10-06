import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  logReticulumSidecarStderrLine,
  normalizeReticulumSidecarOutputLine,
  resolveSidecarRustLog,
  ReticulumSidecarStderrDedupe,
  ReticulumSidecarTcpReadErrorDedupe,
  shouldForwardReticulumSidecarStdout,
  SIDECAR_DEFAULT_RUST_LOG,
} from './reticulumSidecarStderrLog';

const TCP_RST_ID4 =
  '2026-10-05T23:54:35.152482Z WARN rns_interface::tcp: TCP read error interface_id=4 error=Connection reset by peer (os error 54)';
const TCP_RST_ID5 =
  '2026-10-05T23:54:36.000000Z WARN rns_interface::tcp: TCP read error interface_id=5 error=Connection reset by peer (os error 54)';

describe('shouldForwardReticulumSidecarStdout', () => {
  it('forwards WARN and ERROR tracing lines', () => {
    expect(
      shouldForwardReticulumSidecarStdout(
        normalizeReticulumSidecarOutputLine(
          '2026-07-30T11:23:18Z \u001b[33m WARN \u001b[0m auto: failed to select multicast',
        ),
      ),
    ).toBe(true);
    expect(
      shouldForwardReticulumSidecarStdout(
        '2026-07-30T11:23:18Z \u001b[33m WARN \u001b[0m auto: failed to select multicast',
      ),
    ).toBe(false);
    expect(shouldForwardReticulumSidecarStdout('ERROR panic in link_manager')).toBe(true);
  });

  it('drops INFO and DEBUG packet-routing spam', () => {
    expect(
      shouldForwardReticulumSidecarStdout(
        normalizeReticulumSidecarOutputLine(
          '\u001b[32m INFO \u001b[0m rns_transport::actor::inbound : data packet routing',
        ),
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
    expect(
      shouldForwardReticulumSidecarStdout(
        '2026-09-12T13:00:00Z INFO rrc: rrc DropAndRefresh failover',
      ),
    ).toBe(true);
    expect(
      shouldForwardReticulumSidecarStdout(
        '2026-09-29T14:00:00Z INFO gatt: gatt connect stage stage="subscribe" elapsed_ms=4210 profile=meshcore',
      ),
    ).toBe(true);
  });

  it('keeps rns_interface::tcp INFO out of the app log but forwards its WARN', () => {
    expect(
      shouldForwardReticulumSidecarStdout(
        '2026-10-05T23:54:35.152600Z INFO rns_interface::tcp: reconnecting in 5s name=RMAP World',
      ),
    ).toBe(false);
    expect(
      shouldForwardReticulumSidecarStdout(
        '2026-10-05T23:54:35.152482Z INFO rns_interface::tcp: TCP read: EOF interface_id=4',
      ),
    ).toBe(false);
    expect(shouldForwardReticulumSidecarStdout(TCP_RST_ID4)).toBe(true);
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

describe('normalizeReticulumSidecarOutputLine', () => {
  // tracing-subscriber default fmt with ANSI: dimmed timestamp, colored level, dimmed target.
  const coloredInfo =
    '\u001b[2m2026-10-05T16:51:03.401234Z\u001b[0m \u001b[32m INFO\u001b[0m \u001b[2mgatt\u001b[0m\u001b[2m:\u001b[0m gatt connect stage \u001b[3mstage\u001b[0m\u001b[2m=\u001b[0m"connect" \u001b[3melapsed_ms\u001b[0m\u001b[2m=\u001b[0m12';
  const coloredWarn =
    '\u001b[2m2026-10-05T16:51:44.401234Z\u001b[0m \u001b[33m WARN\u001b[0m \u001b[2mgatt\u001b[0m\u001b[2m:\u001b[0m gatt: backend call exceeded budget — Bluetooth stack unresponsive';

  it('keeps colored gatt INFO and WARN lines forwardable', () => {
    const info = normalizeReticulumSidecarOutputLine(coloredInfo);
    expect(info).toBe(
      '2026-10-05T16:51:03.401234Z INFO gatt: gatt connect stage stage="connect" elapsed_ms=12',
    );
    expect(shouldForwardReticulumSidecarStdout(info)).toBe(true);
    expect(
      shouldForwardReticulumSidecarStdout(normalizeReticulumSidecarOutputLine(coloredWarn)),
    ).toBe(true);
  });

  it('sanitizing alone (old path) hides the level from the forward filter', () => {
    const sanitizedOnly = coloredWarn.replace(/[\x00-\x1F\x7F]+/g, ' '); // eslint-disable-line no-control-regex
    expect(shouldForwardReticulumSidecarStdout(sanitizedOnly)).toBe(false);
  });

  it('still strips control characters and newlines', () => {
    expect(normalizeReticulumSidecarOutputLine('  WARN a\nb\u0007c  ')).toBe('WARN a b c');
  });
});

describe('resolveSidecarRustLog', () => {
  it('defaults to warn', () => {
    expect(resolveSidecarRustLog({})).toBe(SIDECAR_DEFAULT_RUST_LOG);
    expect(SIDECAR_DEFAULT_RUST_LOG).toContain('rrc=info');
    expect(SIDECAR_DEFAULT_RUST_LOG).toContain('gatt=info');
    expect(SIDECAR_DEFAULT_RUST_LOG).toContain('rns_interface::tcp=info');
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

describe('ReticulumSidecarTcpReadErrorDedupe', () => {
  it('passes non-TCP-read-error lines through as warn unchanged', () => {
    const dedupe = new ReticulumSidecarTcpReadErrorDedupe();
    const line = '2026-10-05T23:52:41Z WARN lxmf-outbound: no preferred propagation destination';
    expect(dedupe.decide(line, 0)).toEqual({ level: 'warn', message: line });
    expect(dedupe.decide(line, 1)).toEqual({ level: 'warn', message: line });
  });

  it('warns once per minute per interface_id with a suppressed-count summary', () => {
    const dedupe = new ReticulumSidecarTcpReadErrorDedupe();
    expect(dedupe.decide(TCP_RST_ID4, 0)).toEqual({ level: 'warn', message: TCP_RST_ID4 });
    expect(dedupe.decide(TCP_RST_ID4, 5_500).level).toBe('debug');
    expect(dedupe.decide(TCP_RST_ID4, 11_000).level).toBe('debug');
    const summary = dedupe.decide(TCP_RST_ID4, 60_000);
    expect(summary.level).toBe('warn');
    expect(summary.message).toContain('(suppressed 2 similar TCP read errors for interface_id=4)');
    expect(dedupe.decide(TCP_RST_ID4, 65_000).level).toBe('debug');
  });

  it('rate-limits separate interface_ids independently', () => {
    const dedupe = new ReticulumSidecarTcpReadErrorDedupe();
    expect(dedupe.decide(TCP_RST_ID4, 0).level).toBe('warn');
    expect(dedupe.decide(TCP_RST_ID5, 1_000).level).toBe('warn');
    expect(dedupe.decide(TCP_RST_ID4, 2_000).level).toBe('debug');
    expect(dedupe.decide(TCP_RST_ID5, 3_000).level).toBe('debug');
  });

  it('adds the resolved interface name to warn lines', () => {
    const names = new Map<number, string>();
    const dedupe = new ReticulumSidecarTcpReadErrorDedupe((id) => names.get(id));
    expect(dedupe.decide(TCP_RST_ID4, 0).message).toBe(TCP_RST_ID4);
    names.set(4, 'RMAP World');
    dedupe.decide(TCP_RST_ID4, 5_500);
    const summary = dedupe.decide(TCP_RST_ID4, 60_000);
    expect(summary.message).toBe(
      `${TCP_RST_ID4} name=RMAP World (suppressed 1 similar TCP read errors for interface_id=4)`,
    );
  });

  it('reset() starts a fresh window (interface ids are per sidecar process)', () => {
    const dedupe = new ReticulumSidecarTcpReadErrorDedupe();
    dedupe.decide(TCP_RST_ID4, 0);
    dedupe.reset();
    expect(dedupe.decide(TCP_RST_ID4, 1_000)).toEqual({ level: 'warn', message: TCP_RST_ID4 });
  });
});
