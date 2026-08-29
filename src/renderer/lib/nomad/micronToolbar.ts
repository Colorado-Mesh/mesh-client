/**
 * Pure text transforms for the Micron page editor toolbar.
 *
 * Syntax matches the vendored `micron-parser.js`: formatting is a backtick escape
 * followed by a toggle character (`` `! `` bold, `` `* `` italic, `` `_ `` underline),
 * headings are leading `>` runs, alignment is a `` `c `` / `` `l `` / `` `r `` line
 * prefix, and links are `` `[label`destination] ``.
 */

/** Selection-wrapping formats (toggle on, toggle off). */
export type MicronWrapAction = 'bold' | 'italic' | 'underline';

/** Whole-line formats. */
export type MicronLineAction = 'h1' | 'h2' | 'h3' | 'alignLeft' | 'alignCenter' | 'alignRight';

export type MicronToolbarAction = MicronWrapAction | MicronLineAction | 'divider' | 'link';

export interface MicronEditState {
  content: string;
  /** Caret start (or selection anchor). */
  start: number;
  /** Caret end (equal to `start` when there is no selection). */
  end: number;
}

export interface MicronEditResult {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

const WRAP_MARKERS: Record<MicronWrapAction, string> = {
  bold: '`!',
  italic: '`*',
  underline: '`_',
};

const HEADING_PREFIXES = {
  h1: '>',
  h2: '>>',
  h3: '>>>',
} as const;

const ALIGN_PREFIXES = {
  alignLeft: '`l',
  alignCenter: '`c',
  alignRight: '`r',
} as const;

/** Placeholder used when a wrap/link action runs with no selection. */
export const MICRON_LINK_LABEL_FALLBACK = 'link';

function clampRange(state: MicronEditState): { start: number; end: number } {
  const max = state.content.length;
  const rawStart = Math.max(0, Math.min(state.start, max));
  const rawEnd = Math.max(0, Math.min(state.end, max));
  return { start: Math.min(rawStart, rawEnd), end: Math.max(rawStart, rawEnd) };
}

/** Start index of the line containing `index`. */
function lineStart(content: string, index: number): number {
  const nl = content.lastIndexOf('\n', Math.max(0, index - 1));
  return nl === -1 ? 0 : nl + 1;
}

/**
 * Wrap the selection in Micron toggle markers.
 * With an empty selection the markers are inserted and the caret is placed between
 * them so the user can type straight into the new span.
 */
export function applyMicronWrap(
  state: MicronEditState,
  action: MicronWrapAction,
): MicronEditResult {
  const marker = WRAP_MARKERS[action];
  const { start, end } = clampRange(state);
  const selected = state.content.slice(start, end);
  const content = `${state.content.slice(0, start)}${marker}${selected}${marker}${state.content.slice(end)}`;

  if (selected.length === 0) {
    const caret = start + marker.length;
    return { content, selectionStart: caret, selectionEnd: caret };
  }
  return {
    content,
    selectionStart: start + marker.length,
    selectionEnd: start + marker.length + selected.length,
  };
}

/**
 * Apply a line-level prefix (heading or alignment) to the line holding the caret.
 * Re-applying the same prefix removes it, and switching between prefixes of the
 * same family replaces rather than stacks them.
 */
export function applyMicronLinePrefix(
  state: MicronEditState,
  action: MicronLineAction,
): MicronEditResult {
  const { start } = clampRange(state);
  const from = lineStart(state.content, start);
  const lineEnd = state.content.indexOf('\n', from);
  const line = state.content.slice(from, lineEnd === -1 ? undefined : lineEnd);

  const isHeading = action === 'h1' || action === 'h2' || action === 'h3';
  const prefix = isHeading ? HEADING_PREFIXES[action] : ALIGN_PREFIXES[action];
  // Strip any existing prefix from the same family so toggles replace each other.
  const existing = isHeading ? /^>+/.exec(line)?.[0] : /^`[lcr]/.exec(line)?.[0];

  const bare = existing ? line.slice(existing.length) : line;
  const next = existing === prefix ? bare : `${prefix}${bare}`;

  const delta = next.length - line.length;
  const content = `${state.content.slice(0, from)}${next}${state.content.slice(from + line.length)}`;
  const caret = Math.max(from, start + delta);
  return { content, selectionStart: caret, selectionEnd: caret };
}

/** Insert a horizontal divider on its own line below the caret. */
export function applyMicronDivider(state: MicronEditState): MicronEditResult {
  const { end } = clampRange(state);
  const before = state.content.slice(0, end);
  const after = state.content.slice(end);
  const leading = before.length === 0 || before.endsWith('\n') ? '' : '\n';
  const trailing = after.startsWith('\n') || after.length === 0 ? '' : '\n';
  const insert = `${leading}-\n${trailing}`;
  const caret = end + insert.length;
  return {
    content: `${before}${insert}${after}`,
    selectionStart: caret,
    selectionEnd: caret,
  };
}

/** Insert a Micron link, using the selection as the label when present. */
export function applyMicronLink(
  state: MicronEditState,
  destination: string,
  label?: string,
): MicronEditResult {
  const { start, end } = clampRange(state);
  const selected = state.content.slice(start, end);
  const resolvedLabel = (label ?? selected).trim() || MICRON_LINK_LABEL_FALLBACK;
  const insert = `\`[${resolvedLabel}\`${destination}]`;
  const caret = start + insert.length;
  return {
    content: `${state.content.slice(0, start)}${insert}${state.content.slice(end)}`,
    selectionStart: caret,
    selectionEnd: caret,
  };
}
