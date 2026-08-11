import { existsSync } from 'fs';

import { isLoopbackHost } from './connectHost';
import { clampTcpPort } from './tcpPort';

/**
 * Headless "server mode" configuration (issue #824).
 *
 * When `MESH_CLIENT_HEADLESS=1` (or the process runs inside a container), the
 * Electron main process runs the full existing client in a mapped
 * (mapped-into-Xvfb) BrowserWindow and exposes it to browsers over HTTP +
 * WebSocket. All knobs live in this single module so renderer, main, and tests
 * read one source of truth.
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
/** Max concurrent browser WebSocket sessions (viewers + controller). */
export const HEADLESS_MAX_WS_CLIENTS = 8;
/** Max inbound WS text/binary payload (bytes). */
export const HEADLESS_WS_MAX_PAYLOAD_BYTES = 64 * 1024;
/** Per-socket input frames allowed per rolling window. */
export const HEADLESS_INPUT_RATE_MAX = 120;
export const HEADLESS_INPUT_RATE_WINDOW_MS = 1000;
/** Failed auth attempts per peer before silent reject (HTTP + WS). */
export const HEADLESS_AUTH_FAIL_MAX = 5;
export const HEADLESS_AUTH_FAIL_WINDOW_MS = 60_000;
/** Cap how long `stop()` waits for `httpServer.close`. */
export const HEADLESS_STOP_TIMEOUT_MS = 5_000;

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

/**
 * True when running inside a container. Docker always mounts a bare
 * `/.dockerenv`; Podman uses `/run/.containerenv`. `checkExists` is injectable so
 * tests do not depend on the host.
 */
export function isDockerContainer(checkExists: (path: string) => boolean = existsSync): boolean {
  return checkExists('/.dockerenv') || checkExists('/run/.containerenv');
}

/**
 * Server mode is selected by `MESH_CLIENT_HEADLESS=1` — and always when running
 * inside a container, where there is no desktop/display to show the window on.
 * Parsed per call (cheap); main caches it once. `dockerDetect` is injectable for
 * deterministic tests.
 */
export function isHeadlessServerMode(
  env: NodeJS.ProcessEnv = process.env,
  dockerDetect: () => boolean = isDockerContainer,
): boolean {
  return parseBooleanEnv(env.MESH_CLIENT_HEADLESS) || dockerDetect();
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

/**
 * True when binding this host without a token would expose the remote desktop
 * beyond the local machine. Loopback (`127.0.0.0/8`, `::1`) and `localhost`
 * may run open for local tooling; `0.0.0.0` / LAN / public hosts require a token.
 */
export function headlessBindRequiresToken(host: string): boolean {
  const bare = host.trim().toLowerCase();
  if (!bare) return true;
  if (bare === 'localhost') return false;
  return !isLoopbackHost(bare);
}
