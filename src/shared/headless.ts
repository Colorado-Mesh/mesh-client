import { clampTcpPort } from './tcpPort';

/**
 * Headless "server mode" configuration (issue #824).
 *
 * When `MESH_CLIENT_HEADLESS=1`, the Electron main process runs the full existing
 * client in a mapped (mapped-into-Xvfb) BrowserWindow and exposes it to browsers
 * over HTTP + WebSocket. All knobs live in this single module so renderer, main,
 * and tests read one source of truth.
 */

export const HEADLESS_HOST_DEFAULT = '0.0.0.0';
export const HEADLESS_PORT_DEFAULT = 8000;
/** Max frames/s per active session (clamped to 1..15). */
export const HEADLESS_FPS_DEFAULT = 5;
export const HEADLESS_FPS_MIN = 1;
export const HEADLESS_FPS_MAX = 15;
/** JPEG quality integer (clamped to 1..100). */
export const HEADLESS_JPEG_QUALITY_DEFAULT = 70;
export const HEADLESS_JPEG_QUALITY_MIN = 1;
export const HEADLESS_JPEG_QUALITY_MAX = 100;
/** Fixed logical window size (`WxH`) for the hidden renderer. */
export const HEADLESS_VIEWPORT_DEFAULT = '1280x800';
export const HEADLESS_VIEWPORT_WIDTH_DEFAULT = 1280;
export const HEADLESS_VIEWPORT_HEIGHT_DEFAULT = 800;
/** WebSocket ping interval (seconds). */
export const HEADLESS_WS_HEARTBEAT_SEC_DEFAULT = 30;
/** Cookie name used to persist the remote-access token in the control page. */
export const HEADLESS_REMOTE_COOKIE_NAME = 'mesh-remote-token';
/** Path under which the WebSocket endpoint is served. */
export const HEADLESS_WS_PATH = '/ws';

export interface HeadlessRemoteConfig {
  /** HTTP/WS bind host (default `0.0.0.0` so containers accept LAN browsers). */
  host: string;
  /** HTTP port, clamped 1–65535 via `clampTcpPort`. */
  port: number;
  /** Optional shared token; empty string disables the gate. Never logged. */
  token: string;
  /** Max frames/s per active session. */
  fps: number;
  /** JPEG encode quality (1..100). */
  jpegQuality: number;
  /** Logical renderer window size. */
  viewportWidth: number;
  viewportHeight: number;
  /** WS ping interval in seconds. */
  wsHeartbeatSec: number;
}

/** True for `'1'`, `'true'`, `'yes'`, `'on'` (case-insensitive); anything else false. */
export function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Parse a `WxH` viewport string; returns the fallback width/height on garbage. */
export function parseViewportSize(
  value: string,
  fallbackWidth: number,
  fallbackHeight: number,
): {
  width: number;
  height: number;
} {
  const parts = value.trim().toLowerCase().split('x');
  if (parts.length !== 2) return { width: fallbackWidth, height: fallbackHeight };
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return { width: fallbackWidth, height: fallbackHeight };
  }
  if (width > 10_000 || height > 10_000) {
    return { width: fallbackWidth, height: fallbackHeight };
  }
  return { width, height };
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** `MESH_CLIENT_HEADLESS=1` selects server mode. Parsed per call (cheap); main caches it once. */
export function isHeadlessServerMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanEnv(env.MESH_CLIENT_HEADLESS);
}

/**
 * Read + clamp the full headless remote configuration from the environment.
 * Never throws: any combination of env must still boot the app.
 */
export function getHeadlessRemoteConfig(
  env: NodeJS.ProcessEnv = process.env,
): HeadlessRemoteConfig {
  const viewport = parseViewportSize(
    env.MESH_CLIENT_REMOTE_VIEWPORT ?? HEADLESS_VIEWPORT_DEFAULT,
    HEADLESS_VIEWPORT_WIDTH_DEFAULT,
    HEADLESS_VIEWPORT_HEIGHT_DEFAULT,
  );
  return {
    host: env.MESH_CLIENT_REMOTE_HOST?.trim() || HEADLESS_HOST_DEFAULT,
    port: clampTcpPort(env.MESH_CLIENT_REMOTE_PORT ?? '', HEADLESS_PORT_DEFAULT),
    token: env.MESH_CLIENT_REMOTE_TOKEN?.trim() ?? '',
    fps: clampInt(
      env.MESH_CLIENT_REMOTE_FPS,
      HEADLESS_FPS_DEFAULT,
      HEADLESS_FPS_MIN,
      HEADLESS_FPS_MAX,
    ),
    jpegQuality: clampInt(
      env.MESH_CLIENT_REMOTE_JPEG_QUALITY,
      HEADLESS_JPEG_QUALITY_DEFAULT,
      HEADLESS_JPEG_QUALITY_MIN,
      HEADLESS_JPEG_QUALITY_MAX,
    ),
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    wsHeartbeatSec: clampInt(
      env.MESH_CLIENT_REMOTE_WS_HEARTBEAT_SEC,
      HEADLESS_WS_HEARTBEAT_SEC_DEFAULT,
      1,
      300,
    ),
  };
}

/** Format a viewport as `WxH` for logging / control-page `hello`. */
export function formatViewport(width: number, height: number): string {
  return `${width}x${height}`;
}
