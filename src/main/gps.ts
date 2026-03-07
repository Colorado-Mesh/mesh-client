import http from "http";
import https from "https";
import si from "systeminformation";

function sanitizeLogMessage(message: unknown): string {
  // Remove newline and carriage return characters to prevent log injection.
  return String(message).replace(/[\r\n]+/g, " ");
}

export type GpsFixSource = "native" | "ip";

export interface GpsFix {
  lat: number;
  lon: number;
  source: GpsFixSource;
}

export interface GpsFixError {
  status: "error";
  message: string;
  code?: string;
}

export type GpsFixResult = GpsFix | GpsFixError;

export class GpsHardwareError extends Error {
  code = "NO_FIX";
  constructor(message: string) {
    super(message);
    this.name = "GpsHardwareError";
  }
}

// ─── IP geolocation via Node http(s) with WHATWG URL (avoids Electron net + url.parse) ───

function fetchIpEndpoint(
  url: string,
  extract: (data: unknown) => GpsFix | null
): Promise<GpsFix> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return Promise.reject(new Error("Invalid URL"));
  }
  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    return Promise.reject(new Error("URL must be http or https"));
  }
  const protocol = parsedUrl.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = protocol.request(
      parsedUrl,
      { method: "GET" },
      (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        response.on("end", () => {
          clearTimeout(timer);
          try {
            const fix = extract(JSON.parse(body));
            if (fix) resolve(fix);
            else reject(new Error("no lat/lon in response"));
          } catch (e) {
            reject(new Error(`parse error: ${e}`));
          }
        });
        response.on("error", (e: Error) => {
          clearTimeout(timer);
          reject(e);
        });
      }
    );
    const timer = setTimeout(() => {
      request.destroy();
      reject(new Error("timeout"));
    }, 5000);
    request.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    request.end();
  });
}

async function getIpFix(): Promise<GpsFix> {
  try {
    return await fetchIpEndpoint("http://ip-api.com/json/", (d: unknown) => {
      const x = d as { status?: string; lat?: number; lon?: number };
      return x.status === "success" &&
        typeof x.lat === "number" &&
        typeof x.lon === "number"
        ? { lat: x.lat, lon: x.lon, source: "ip" as const }
        : null;
    });
  } catch (e) {
    const msg = sanitizeLogMessage((e as Error).message);
    console.warn(
      `[gps] ip-api.com failed: ${msg}, trying ipwho.is`
    );
  }
  return fetchIpEndpoint("https://ipwho.is/", (d: unknown) => {
    const x = d as { success?: boolean; latitude?: number; longitude?: number };
    return x.success &&
      typeof x.latitude === "number" &&
      typeof x.longitude === "number"
      ? { lat: x.latitude, lon: x.longitude, source: "ip" as const }
      : null;
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getGpsFix(): Promise<GpsFixResult> {
  try {
    await si.wifiNetworks();
  } catch {
    // Optional: WiFi scan can fail (permissions, no adapter). Try inetChecksite as fallback.
    try {
      await si.inetChecksite("https://ip-api.com");
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
    console.warn(`[gps] ip fix failed: ${msg}`);
    return {
      status: "error",
      message: "Location unavailable (network or service error).",
      code: "NO_FIX",
    };
  }
}
