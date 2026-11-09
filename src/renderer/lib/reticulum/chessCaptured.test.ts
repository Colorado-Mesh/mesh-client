// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { chessCapturedFromFen } from './chessCaptured';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** After 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# — white captured a pawn. */
const SCHOLARS = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';

describe('chessCapturedFromFen', () => {
  it('reports empty trays at the starting position', () => {
    const snap = chessCapturedFromFen(START);
    expect(snap.whiteCaptured.pieces).toEqual([]);
    expect(snap.blackCaptured.pieces).toEqual([]);
    expect(snap.advantage).toBe(0);
  });

  it('attributes missing black pieces to white captures', () => {
    const snap = chessCapturedFromFen(SCHOLARS);
    expect(snap.whiteCaptured.pieces).toEqual([{ kind: 'p', count: 1 }]);
    expect(snap.whiteCaptured.material).toBe(1);
    expect(snap.blackCaptured.pieces).toEqual([]);
    expect(snap.advantage).toBe(1);
  });
});
