import http from 'http';
import https from 'https';
import si from 'systeminformation';

function sanitizeLogMessage(message: unknown): string {
  // Remove control characters (including newlines and carriage returns) and normalize whitespace
  // to prevent log injection and preserve a single-line log entry.
  return String(message)
    .replace(/[\x00-\x1F\x7F\u2028\u2029]+/g, ' ') // eslint-disable-line no-control-regex
    .replace(/\s+/g, ' ')
    .trim();
}

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
          reject(new Error('response too large'));
          return;
        }
        body += chunk.toString();
      });
      response.on('end', () => {
        clearTimeout(timer);
        try {
          const fix = extract(JSON.parse(body));
          if (fix) resolve(fix);
          else reject(new Error('no lat/lon in response'));
        } catch (e) {
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
      reject(new Error('timeout'));
    }, 5000);
    request.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    request.end();
  });
}

async function getIpFix(): Promise<GpsFix> {
  try {
    return await fetchIpEndpoint('https://ip-api.com/json/', (d: unknown) => {
      const x = d as { status?: string; lat?: number; lon?: number };
      return x.status === 'success' && typeof x.lat === 'number' && typeof x.lon === 'number'
        ? { lat: x.lat, lon: x.lon, source: 'ip' as const }
        : null;
    });
  } catch (e) {
    const msg = sanitizeLogMessage((e as Error).message);
    console.warn(`[gps] ip-api.com failed: ${msg}, trying ipwho.is`); // codeql[js/log-injection] -- msg is sanitized by sanitizeLogMessage (strips control chars)
  }
  return fetchIpEndpoint('https://ipwho.is/', (d: unknown) => {
    const x = d as { success?: boolean; latitude?: number; longitude?: number };
    return x.success && typeof x.latitude === 'number' && typeof x.longitude === 'number'
      ? { lat: x.latitude, lon: x.longitude, source: 'ip' as const }
      : null;
  });
}

// Keep the system check timeout aligned with the IP geolocation request timeout
// to avoid delaying error responses with a longer pre-check.
const GPS_SYSTEM_CHECK_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getGpsFix(): Promise<GpsFixResult> {
  try {
    // Use a WiFi network scan as a lightweight system check: this verifies that
    // the systeminformation module has required permissions and that basic
    // network interfaces are available before attempting IP geolocation.
    // The actual scan result is not used; failures are handled by falling back
    // to inetChecksite below.
    await withTimeout(si.wifiNetworks(), GPS_SYSTEM_CHECK_TIMEOUT_MS, undefined);
  } catch {
    // Optional: WiFi scan can fail (permissions, no adapter). Try inetChecksite as fallback.
    try {
      await withTimeout(
        si.inetChecksite('https://ip-api.com'),
        GPS_SYSTEM_CHECK_TIMEOUT_MS,
        undefined,
      );
    } catch (e) {
      const msg = sanitizeLogMessage((e as Error).message);
      console.warn(`[gps] inetChecksite fallback failed: ${msg}`);
    }
  }

  try {
    const fix = await getIpFix();
    console.log(`[gps] ip fix: ${fix.lat}, ${fix.lon}`);
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
