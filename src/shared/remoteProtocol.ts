/**
 * Wire protocol for headless server mode (issue #824).
 *
 * JSON text frames carry control traffic (auth, hello, status, input); JPEG
 * frames travel as single binary WebSocket messages. Types are shared so the
 * main-process server and tests agree on the exact shape.
 */

/** Control-page request authentication state used by the page itself. */
export type HeadlessAuthMode = 'open' | 'token';

/** Server → client control frames (JSON text). */
export type ServerControlMessage =
  | {
      type: 'hello';
      sessionId: string;
      width: number;
      height: number;
      fps: number;
      jpegQuality: number;
    }
  | {
      type: 'status';
      ready: boolean;
      rendererLoaded: boolean;
      connectedSockets: number;
      uptimeSec: number;
    };

/** Client → server control frames (JSON text). */
export type ClientInputMessage =
  | { type: 'mousemove'; x: number; y: number; buttons: number }
  | { type: 'mousedown'; x: number; y: number; button: 'left' | 'middle' | 'right' }
  | { type: 'mouseup'; x: number; y: number; button: 'left' | 'middle' | 'right' }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'keydown'; key: string; code: string; modifiers: string[] }
  | { type: 'keyup'; key: string; code: string; modifiers: string[] }
  | { type: 'char'; char: string }
  | { type: 'resize'; width: number; height: number };

export const HEADLESS_MOUSE_BUTTONS = ['left', 'middle', 'right'] as const;
export type HeadlessMouseButton = (typeof HEADLESS_MOUSE_BUTTONS)[number];

export const HEADLESS_INPUT_MODIFIERS = ['ctrl', 'alt', 'shift', 'meta'] as const;
export type HeadlessInputModifier = (typeof HEADLESS_INPUT_MODIFIERS)[number];

/** Guard: reject non-object control frames with unknown/dangerous shapes. */
export function isClientInputMessage(value: unknown): value is ClientInputMessage {
  if (!value || typeof value !== 'object') return false;
  const msg = value as Record<string, unknown>;
  const type = msg.type;
  switch (type) {
    case 'mousemove':
      return (
        typeof msg.x === 'number' && typeof msg.y === 'number' && typeof msg.buttons === 'number'
      );
    case 'mousedown':
    case 'mouseup':
      return (
        typeof msg.x === 'number' &&
        typeof msg.y === 'number' &&
        (HEADLESS_MOUSE_BUTTONS as readonly string[]).includes(String(msg.button))
      );
    case 'wheel':
      return (
        typeof msg.x === 'number' &&
        typeof msg.y === 'number' &&
        typeof msg.deltaX === 'number' &&
        typeof msg.deltaY === 'number'
      );
    case 'keydown':
    case 'keyup':
      return (
        typeof msg.key === 'string' &&
        typeof msg.code === 'string' &&
        Array.isArray(msg.modifiers) &&
        msg.modifiers.every((m) =>
          (HEADLESS_INPUT_MODIFIERS as readonly string[]).includes(String(m)),
        )
      );
    case 'char':
      return typeof msg.char === 'string' && msg.char.length > 0;
    case 'resize':
      return typeof msg.width === 'number' && typeof msg.height === 'number';
    default:
      return false;
  }
}

/** Normalized modifiers array: dedupe, lowercase, canonical ctrl/alt/shift/meta order. */
export function normalizeModifiers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const present = new Set(raw.map((m) => String(m).toLowerCase()));
  return HEADLESS_INPUT_MODIFIERS.filter((mod) => present.has(mod));
}

/** Clamp client-supplied coordinates to a sane range before feeding `sendInputEvent`. */
export function clampHeadlessCoordinate(value: unknown, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n)));
}
