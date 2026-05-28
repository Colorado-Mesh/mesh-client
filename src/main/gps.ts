import http from 'http';
import https from 'https';
import si from 'systeminformation';

import { sanitizeLogMessage } from './log-service';

export type GpsFixSource = 'native' | 'ip';

export interface GpsFix {
  lat: number;
  lon: number;
  source: GpsFixSource;
}

export interface GpsFixError {
  status: 'error';
  message: string;
  code?: string;
}

export type GpsFixResult = GpsFix | GpsFixError;

export class GpsHardwareError extends Error {
  code = 'NO_FIX';
  constructor(message: string) {
    super(message);
    this.name = 'GpsHardwareError';
  }
}

// Max response body size before refusing to parse (limits memory for malformed/huge responses)
const MAX_IP_RESPONSE_BYTES = 64 * 1024;

// ─── IP geolocation via Node http(s) with WHATWG URL (avoids Electron net + url.parse) ───

function fetchIpEndpoint(url: string, extract: (data: unknown) => GpsFix | null): Promise<GpsFix> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    // catch-no-log-ok URL parse failure — propagated as rejected Promise to caller
    return Promise.reject(new Error('Invalid URL'));
  }
  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    return Promise.reject(new Error('URL must be http or https'));
  }
  const protocol = parsedUrl.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = protocol.request(parsedUrl, { method: 'GET' }, (response) => {
      let body = '';
      response.on('data', (chunk: Buffer) => {
        if (body.length + chunk.length > MAX_IP_RESPONSE_BYTES) {
          clearTimeout(timer);
          request.destroy();
          reject(new Error('Response body exceeds maximum size limit'));
          return;
        }
        body += chunk.toString();
      });
      response.on('end', () => {
        clearTimeout(timer);
        try {
          const fix = extract(JSON.parse(body));
          if (fix) resolve(fix);
          else reject(new Error('No latitude/longitude data found in response'));
        } catch (e) {
          // catch-no-log-ok JSON parse error — sanitized and propagated via reject()
          const rawMessage = e instanceof Error ? e.message : String(e);
          const safeMessage = sanitizeLogMessage(rawMessage);
          reject(new Error('parse error: ' + safeMessage));
        }
      });
      response.on('error', (e: Error) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    const timer = setTimeout(() => {
      request.destroy();
      reject(new Error('Request timeout exceeded while fetching IP geolocation'));
    }, 5000);
    request.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    request.end();
  });
}

async function getIpFix(): Promise<GpsFix> {
  return fetchIpEndpoint('https://ipwho.is/', (d: unknown) => {
    const x = d as { success?: boolean; latitude?: number; longitude?: number };
    if (
      !x.success ||
      typeof x.latitude !== 'number' ||
      typeof x.longitude !== 'number' ||
      x.latitude < -90 ||
      x.latitude > 90 ||
      x.longitude < -180 ||
      x.longitude > 180
    ) {
      return null;
    }
    return { lat: x.latitude, lon: x.longitude, source: 'ip' as const };
  });
}

// Keep the system check timeout aligned with the IP geolocation request timeout
// to avoid delaying error responses with a longer pre-check.
const GPS_SYSTEM_CHECK_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) =>
      setTimeout(() => {
        resolve(fallback);
      }, ms),
    ),
  ]);
}

/** Whether to run si.wifiNetworks() as the GPS preflight (exported for tests). */
export function shouldUseWifiNetworksPreflight(): boolean {
  // Windows: systeminformation wifiNetworks() uses powerShell().then() internally;
  // parse errors reject that inner chain, not the promise returned to callers, so
  // .catch() on wifiNetworks() cannot prevent unhandled rejections (wifi.js ~493).
  return process.platform !== 'win32';
}

async function inetChecksitePreflight(): Promise<void> {
  try {
    await withTimeout(si.inetChecksite('https://ipwho.is'), GPS_SYSTEM_CHECK_TIMEOUT_MS, undefined);
  } catch (e) {
    const msg = sanitizeLogMessage((e as Error).message);
    console.warn(`[gps] inetChecksite preflight failed: ${msg}`);
  }
}

/** Lightweight connectivity check before IP geolocation (result discarded). */
async function runGpsConnectivityPreflight(): Promise<void> {
  if (!shouldUseWifiNetworksPreflight()) {
    await inetChecksitePreflight();
    return;
  }

  // WiFi scan verifies permissions / interfaces on macOS and Linux. Attach .catch()
  // so a late rejection after the timeout race does not surface as unhandled.
  const wifiPromise = si.wifiNetworks().catch(() => undefined);
  await withTimeout(wifiPromise, GPS_SYSTEM_CHECK_TIMEOUT_MS, undefined);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getGpsFix(): Promise<GpsFixResult> {
  await runGpsConnectivityPreflight();

  try {
    const fix = await getIpFix();
    console.debug(
      `[gps] ip fix: ${sanitizeLogMessage(String(fix.lat))}, ${sanitizeLogMessage(String(fix.lon))}`,
    );
    return fix;
  } catch (e) {
    const msg = sanitizeLogMessage((e as Error).message);
    console.warn(`[gps] ip fix failed: msg="${msg}"`); // codeql[js/log-injection] -- msg is sanitized by sanitizeLogMessage (strips control chars)
    return {
      status: 'error',
      message: 'Location unavailable (network or service error).',
      code: 'NO_FIX',
    };
  }
}
