import net from 'net';

import { formatHostForSocket } from '../shared/connectHost';
import { MS_PER_SECOND } from '../shared/timeConstants';
import { sanitizeLogMessage } from './log-service';

/** Align with renderer `HOST_LINK_RTT_PROBE_TIMEOUT_MS`. */
export const HOST_LINK_RTT_PROBE_TIMEOUT_MS = 3 * MS_PER_SECOND;

/**
 * Time a Meshtastic HTTP `/json/report` GET. Returns RTT ms, or null on failure.
 * Does not throw — callers treat null as "no bars".
 */
export async function probeHttpRttMs(host: string, tls: boolean): Promise<number | null> {
  const protocol = tls ? 'https' : 'http';
  const url = `${protocol}://${host}/json/report`;
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HOST_LINK_RTT_PROBE_TIMEOUT_MS) });
    const rtt = Date.now() - started;
    if (!res.ok) {
      console.debug(
        `[hostLink] HTTP probe non-OK ${res.status} for ${sanitizeLogMessage(host)} rtt=${rtt}ms`,
      );
      // Still usable as latency if the host answered quickly.
      return rtt;
    }
    return rtt;
  } catch (err) {
    console.debug(
      `[hostLink] HTTP probe failed for ${sanitizeLogMessage(host)}:`,
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    return null;
  }
}

/**
 * Time a TCP connect to host:port, then destroy the socket immediately.
 * Measures LAN reachability latency without attaching a protocol session.
 */
export function probeTcpRttMs(host: string, port: number): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    const socketHost = formatHostForSocket(host);
    const socket = new net.Socket();
    const started = Date.now();
    const finish = (rtt: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.removeAllListeners();
        socket.destroy();
      } catch {
        // catch-no-log-ok probe socket cleanup
      }
      resolve(rtt);
    };
    const timer = setTimeout(() => {
      finish(null);
    }, HOST_LINK_RTT_PROBE_TIMEOUT_MS);
    socket.once('connect', () => {
      finish(Date.now() - started);
    });
    socket.once('error', (err) => {
      console.debug(
        `[hostLink] TCP probe failed for ${sanitizeLogMessage(socketHost)}:${port}:`,
        sanitizeLogMessage(err.message),
      );
      finish(null);
    });
    try {
      socket.connect(port, socketHost);
    } catch (err) {
      console.debug(
        `[hostLink] TCP probe connect threw for ${sanitizeLogMessage(socketHost)}:${port}:`,
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      finish(null);
    }
  });
}
