/** Starting piece counts per color (lowercase kinds). */
const STARTING_COUNTS: Readonly<Record<string, number>> = {
  p: 8,
  n: 2,
  b: 2,
  r: 2,
  q: 1,
};

const TRAY_ORDER = ['q', 'r', 'b', 'n', 'p'] as const;

export type ChessPieceKind = (typeof TRAY_ORDER)[number];

export interface ChessCapturedTray {
  /** Pieces this side has captured (opponent's missing pieces). */
  pieces: { kind: ChessPieceKind; count: number }[];
  /** Material score of pieces in this tray. */
  material: number;
}

export interface ChessMaterialSnapshot {
  whiteCaptured: ChessCapturedTray;
  blackCaptured: ChessCapturedTray;
  /** Positive when white leads in material from captures; negative when black leads. */
  advantage: number;
}

function materialValue(kind: string): number {
  switch (kind) {
    case 'p':
      return 1;
    case 'n':
    case 'b':
      return 3;
    case 'r':
      return 5;
    case 'q':
      return 9;
    default:
      return 0;
  }
}

/** Count remaining pieces of one color from FEN placement (uppercase = white). */
function countRemaining(fenPlacement: string, white: boolean): Record<string, number> {
  const counts: Record<string, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  for (const ch of fenPlacement) {
    if (ch === '/' || /[1-8]/.test(ch) || ch === 'k' || ch === 'K') continue;
    const isWhite = ch === ch.toUpperCase();
    if (isWhite !== white) continue;
    const kind = ch.toLowerCase();
    if (kind in counts) counts[kind] += 1;
  }
  return counts;
}

function missingAsCaptured(remaining: Record<string, number>): ChessCapturedTray {
  const pieces: { kind: ChessPieceKind; count: number }[] = [];
  let material = 0;
  for (const kind of TRAY_ORDER) {
    const start = STARTING_COUNTS[kind] ?? 0;
    const have = remaining[kind] ?? 0;
    const missing = Math.max(0, start - have);
    if (missing > 0) {
      pieces.push({ kind, count: missing });
      material += missing * materialValue(kind);
    }
  }
  return { pieces, material };
}

/**
 * FEN-diff captured trays (Ratspeak games_tab.js parity): white's tray holds black's
 * missing pieces and vice versa.
 */
export function chessCapturedFromFen(fen: string): ChessMaterialSnapshot {
  const placement = fen.trim().split(/\s+/)[0] ?? '';
  const whiteRemaining = countRemaining(placement, true);
  const blackRemaining = countRemaining(placement, false);
  // White captured = black missing; black captured = white missing.
  const whiteCaptured = missingAsCaptured(blackRemaining);
  const blackCaptured = missingAsCaptured(whiteRemaining);
  return {
    whiteCaptured,
    blackCaptured,
    advantage: whiteCaptured.material - blackCaptured.material,
  };
}
