import { describe, expect, it } from 'vitest';

import {
  computeMobileViewport,
  type SafeAreaInsets,
  SIDE_COLUMN_MIN_HEIGHT,
  sideColumnFor,
  type SideColumnInputs,
  type ViewportInputs,
} from './mobileViewport';

const NO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** iPhone Duo outer display, portrait: 466×678 pt, 84 pt system column on the right. */
const DUO_FOLDED: SideColumnInputs = {
  viewportWidth: 466,
  viewportHeight: 678,
  insets: { ...NO_INSETS, right: 84, bottom: 21 },
  occlusions: [{ left: 396, top: 10, right: 456, bottom: 120 }],
};

function viewport(column: SideColumnInputs, extra: Partial<ViewportInputs> = {}) {
  return computeMobileViewport({
    usableWidth: column.viewportWidth - column.insets.left - column.insets.right,
    usableHeight: column.viewportHeight - column.insets.top - column.insets.bottom,
    fold: null,
    posture: 'flat',
    keyboardOpen: false,
    keyboardInset: 0,
    previousPanes: null,
    sideColumn: column,
    ...extra,
  });
}

describe('sideColumnFor', () => {
  it('finds the iPhone Duo outer-display column below the camera / Dynamic Island', () => {
    expect(sideColumnFor(DUO_FOLDED)).toEqual({ edge: 'right', width: 84, top: 128, bottom: 21 });
  });

  it('follows the column to the left edge (landscape the other way, Split View right app)', () => {
    const left: SideColumnInputs = {
      viewportWidth: 678,
      viewportHeight: 466,
      insets: { ...NO_INSETS, left: 84 },
      occlusions: [{ left: 10, top: 12, right: 74, bottom: 60 }],
    };
    expect(sideColumnFor(left)).toEqual({ edge: 'left', width: 84, top: 68, bottom: 0 });
  });

  it('keeps the bottom bar without a native occlusion rectangle in the column', () => {
    expect(sideColumnFor({ ...DUO_FOLDED, occlusions: [] })).toBeNull();
    // A rectangle elsewhere (inner display camera) says nothing about this inset.
    expect(
      sideColumnFor({ ...DUO_FOLDED, occlusions: [{ left: 200, top: 0, right: 260, bottom: 40 }] }),
    ).toBeNull();
  });

  it('ignores insets on both sides (a notched iPhone in landscape)', () => {
    expect(
      sideColumnFor({
        viewportWidth: 874,
        viewportHeight: 402,
        insets: { top: 0, right: 62, bottom: 21, left: 62 },
        occlusions: [{ left: 0, top: 150, right: 37, bottom: 250 }],
      }),
    ).toBeNull();
  });

  it('ignores insets too narrow for a navigation item', () => {
    expect(sideColumnFor({ ...DUO_FOLDED, insets: { ...NO_INSETS, right: 44 } })).toBeNull();
  });

  it('keeps the bottom bar when the column is too short for the sections and More', () => {
    const short = { ...DUO_FOLDED, viewportHeight: 128 + 21 + SIDE_COLUMN_MIN_HEIGHT - 1 };
    expect(sideColumnFor(short)).toBeNull();
    expect(sideColumnFor({ ...short, viewportHeight: short.viewportHeight + 1 })).not.toBeNull();
  });
});

describe('computeMobileViewport with a side column', () => {
  it('folded Duo: one pane, bar navigation moved into the column', () => {
    const v = viewport(DUO_FOLDED);
    expect(v).toMatchObject({ panes: 1, navRail: false, wide: false });
    expect(v.sideColumn?.edge).toBe('right');
  });

  it('inner display in landscape with a column: column navigation instead of a second rail', () => {
    const inner: SideColumnInputs = {
      viewportWidth: 951,
      viewportHeight: 669,
      insets: { ...NO_INSETS, right: 84 },
      occlusions: [{ left: 880, top: 8, right: 940, bottom: 70 }],
    };
    const v = viewport(inner);
    expect(v).toMatchObject({ panes: 2, navRail: false, wide: true });
    expect(v.sideColumn?.edge).toBe('right');
    // Without the column the same size gets the rail.
    expect(viewport({ ...inner, insets: NO_INSETS, occlusions: [] })).toMatchObject({
      navRail: true,
      sideColumn: null,
    });
  });

  it('keeps the column decision while the keyboard shortens the screen', () => {
    const before = viewport(DUO_FOLDED).sideColumn;
    const typing = viewport(
      { ...DUO_FOLDED, viewportHeight: 300 },
      { keyboardOpen: true, previousSideColumn: before, previousPanes: 1 },
    );
    expect(typing.sideColumn).toEqual(before);
  });
});
