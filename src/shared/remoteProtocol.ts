/**
 * Wire protocol for headless server mode (issue #824).
 *
 * JSON text frames carry control traffic (auth, hello, input); JPEG frames
 * travel as single binary WebSocket messages. Types are shared so the
 * main-process server and tests agree on the exact shape.
 */

/** Max length for key / code / char wire strings (DoS guard before Electron inject). */
export const HEADLESS_INPUT_STRING_MAX = 64;

/** Server → client control frames (JSON text). */
export interface ServerControlMessage {
  type: 'hello';
  sessionId: string;
  width: number;
  height: number;
  fps: number;
  jpegQuality: number;
}

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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= HEADLESS_INPUT_STRING_MAX;
}

/** Guard: reject non-object control frames with unknown/dangerous shapes. */
export function isClientInputMessage(value: unknown): value is ClientInputMessage {
  if (!value || typeof value !== 'object') return false;
  const msg = value as Record<string, unknown>;
  const type = msg.type;
  switch (type) {
    case 'mousemove':
      return isFiniteNumber(msg.x) && isFiniteNumber(msg.y) && isFiniteNumber(msg.buttons);
    case 'mousedown':
    case 'mouseup':
      return (
        isFiniteNumber(msg.x) &&
        isFiniteNumber(msg.y) &&
        (HEADLESS_MOUSE_BUTTONS as readonly string[]).includes(String(msg.button))
      );
    case 'wheel':
      return (
        isFiniteNumber(msg.x) &&
        isFiniteNumber(msg.y) &&
        isFiniteNumber(msg.deltaX) &&
        isFiniteNumber(msg.deltaY)
      );
    case 'keydown':
    case 'keyup':
      return (
        isBoundedString(msg.key) &&
        isBoundedString(msg.code) &&
        Array.isArray(msg.modifiers) &&
        msg.modifiers.every((m) =>
          (HEADLESS_INPUT_MODIFIERS as readonly string[]).includes(String(m)),
        )
      );
    case 'char':
      return isBoundedString(msg.char);
    case 'resize':
      return isFiniteNumber(msg.width) && isFiniteNumber(msg.height);
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
