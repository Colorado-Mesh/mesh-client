import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { mockConsoleWarn } from '@/renderer/lib/vitestConsoleMock';

import {
  CHIP_DRAG_SCROLL_ATTRIBUTE,
  CHIP_ORDER_DRAG_TYPE,
  useChipDragReorder,
} from './useChipDragReorder';

interface HarnessProps {
  onMove: (id: string, target: string, side: 'before' | 'after') => boolean | undefined;
  fixed?: ReadonlySet<string>;
}

/**
 * Keeps its own order and keys chips by position, so a move remounts the chips it passes (the
 * case that loses focus). `scope` stands in for the protocol and radio the order belongs to.
 */
function Reordering({ scope, extra }: { scope: string; extra?: boolean }) {
  const [ids, setIds] = useState(['a', 'b', 'c']);
  const chipDrag = useChipDragReorder({
    scope,
    canMove: () => true,
    onMove: (id, target, side) => {
      const next = ids.filter((entry) => entry !== id);
      next.splice(next.indexOf(target) + (side === 'after' ? 1 : 0), 0, id);
      setIds(next);
      return true;
    },
  });
  return (
    <div {...{ [CHIP_DRAG_SCROLL_ATTRIBUTE]: '' }}>
      {extra && <input aria-label="composer" />}
      {ids.map((id, index) => (
        <button key={`${id}-${String(index)}`} type="button" aria-label={id} {...chipDrag(id)}>
          {id}
        </button>
      ))}
    </div>
  );
}

function Harness({ onMove, fixed = new Set() }: HarnessProps) {
  const chipDrag = useChipDragReorder({ canMove: (id) => !fixed.has(id), onMove });
  return (
    <div data-testid="scroller" {...{ [CHIP_DRAG_SCROLL_ATTRIBUTE]: '' }}>
      {['a', 'b', 'c', 'p'].map((id) => (
        <button key={id} type="button" aria-label={id} {...chipDrag(id)}>
          <span>{id}</span>
        </button>
      ))}
    </div>
  );
}

function transfer() {
  return {
    setData: vi.fn(),
    effectAllowed: 'none',
    dropEffect: 'none',
    types: [CHIP_ORDER_DRAG_TYPE],
  };
}

/** Each chip sits 40 px wide starting at x=100; the drop side follows the pointer half. */
function place(button: HTMLElement) {
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    right: 140,
    width: 40,
    top: 0,
    bottom: 20,
    height: 20,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  });
}

const chip = (id: string) => screen.getByRole('button', { name: id });

// jsdom has no DragEvent, so fireEvent would build a plain Event and drop clientX.
beforeAll(() => {
  vi.stubGlobal('DragEvent', class extends MouseEvent {});
});
afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('dir');
});

describe('useChipDragReorder', () => {
  it('marks the dragged chip and the drop side, then moves on drop', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    const data = transfer();
    fireEvent.dragStart(chip('a'), { dataTransfer: data });
    expect(data.setData).toHaveBeenCalledWith(CHIP_ORDER_DRAG_TYPE, 'a');
    expect(data.effectAllowed).toBe('move');
    expect(chip('a')).toHaveAttribute('data-chip-dragging', 'true');

    place(chip('c'));
    // Not prevented means the browser refuses the drop; prevented means the chip accepts it.
    expect(fireEvent.dragOver(chip('c'), { dataTransfer: data, clientX: 135 })).toBe(false);
    expect(chip('c')).toHaveAttribute('data-drop-side', 'after');
    fireEvent.dragOver(chip('c'), { dataTransfer: data, clientX: 105 });
    expect(chip('c')).toHaveAttribute('data-drop-side', 'before');

    place(chip('b'));
    fireEvent.dragOver(chip('b'), { dataTransfer: data, clientX: 130 });
    expect(chip('c')).not.toHaveAttribute('data-drop-side');
    expect(chip('b')).toHaveAttribute('data-drop-side', 'after');

    fireEvent.drop(chip('b'), { dataTransfer: data, clientX: 130 });
    expect(onMove).toHaveBeenCalledExactlyOnceWith('a', 'b', 'after');
    expect(chip('b')).not.toHaveAttribute('data-drop-side');
    expect(chip('a')).not.toHaveAttribute('data-chip-dragging');
  });

  it('marks the drop side as soon as the pointer enters a chip', () => {
    render(<Harness onMove={vi.fn()} />);
    const data = transfer();
    fireEvent.dragStart(chip('a'), { dataTransfer: data });
    place(chip('c'));
    expect(fireEvent.dragEnter(chip('c'), { dataTransfer: data, clientX: 105 })).toBe(false);
    expect(chip('c')).toHaveAttribute('data-drop-side', 'before');
  });

  it('scrolls an overflowing strip while the pointer is near its top or bottom edge', () => {
    render(<Harness onMove={vi.fn()} />);
    const scroller = screen.getByTestId('scroller');
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 300 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 100 });
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 400,
      width: 400,
      top: 200,
      bottom: 300,
      height: 100,
      x: 0,
      y: 200,
      toJSON: () => ({}),
    });
    scroller.scrollTop = 50;
    const data = transfer();
    fireEvent.dragStart(chip('a'), { dataTransfer: data });
    place(chip('c'));
    fireEvent.dragOver(chip('c'), { dataTransfer: data, clientX: 130, clientY: 250 });
    expect(scroller.scrollTop).toBe(50);
    fireEvent.dragOver(chip('c'), { dataTransfer: data, clientX: 130, clientY: 292 });
    expect(scroller.scrollTop).toBeGreaterThan(50);
    const lower = scroller.scrollTop;
    // The dragged chip itself is not a drop target, but hovering it near an edge still scrolls.
    fireEvent.dragOver(chip('a'), { dataTransfer: data, clientX: 130, clientY: 205 });
    expect(scroller.scrollTop).toBeLessThan(lower);
  });

  it('does not scroll a strip that fits', () => {
    render(<Harness onMove={vi.fn()} />);
    const scroller = screen.getByTestId('scroller');
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 100 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 100 });
    const data = transfer();
    fireEvent.dragStart(chip('a'), { dataTransfer: data });
    place(chip('c'));
    fireEvent.dragOver(chip('c'), { dataTransfer: data, clientX: 130, clientY: 1 });
    expect(scroller.scrollTop).toBe(0);
  });

  it('keeps focus on a focused chip after it is dropped and remounted', () => {
    render(<Reordering scope="meshcore:1" />);
    const data = transfer();
    chip('a').focus();
    fireEvent.dragStart(chip('a'), { dataTransfer: data });
    place(chip('c'));
    fireEvent.dragOver(chip('c'), { dataTransfer: data, clientX: 130 });
    fireEvent.drop(chip('c'), { dataTransfer: data, clientX: 130 });
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'b',
      'c',
      'a',
    ]);
    expect(chip('a')).toHaveFocus();
  });

  it('does not move focus to a chip that did not have it', () => {
    render(<Reordering scope="meshcore:1" extra />);
    const composer = screen.getByRole('textbox', { name: 'composer' });
    composer.focus();
    const data = transfer();
    fireEvent.dragStart(chip('a'), { dataTransfer: data });
    place(chip('c'));
    fireEvent.dragOver(chip('c'), { dataTransfer: data, clientX: 130 });
    fireEvent.drop(chip('c'), { dataTransfer: data, clientX: 130 });
    expect(composer).toHaveFocus();
  });

  it('refuses a drop after the order it belongs to changed', () => {
    const { rerender } = render(<Reordering scope="meshcore:1" />);
    const data = transfer();
    fireEvent.dragStart(chip('a'), { dataTransfer: data });
    // Another radio connects mid-drag; the same chip ids now belong to its order.
    rerender(<Reordering scope="meshcore:2" />);
    place(chip('c'));
    expect(fireEvent.dragOver(chip('c'), { dataTransfer: data, clientX: 130 })).toBe(true);
    expect(chip('c')).not.toHaveAttribute('data-drop-side');
    fireEvent.drop(chip('c'), { dataTransfer: data, clientX: 130 });
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(chip('a')).not.toHaveAttribute('data-chip-dragging');
  });

  it('refuses a drop on the dragged chip itself', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    const data = transfer();
    fireEvent.dragStart(chip('b'), { dataTransfer: data });
    place(chip('b'));
    expect(fireEvent.dragOver(chip('b'), { dataTransfer: data, clientX: 130 })).toBe(true);
    expect(chip('b')).not.toHaveAttribute('data-drop-side');
    fireEvent.drop(chip('b'), { dataTransfer: data, clientX: 130 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('leaves fixed chips undraggable and refuses drops onto them', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} fixed={new Set(['p'])} />);
    expect(chip('p')).not.toHaveAttribute('draggable');
    expect(chip('a')).toHaveAttribute('draggable', 'true');
    const data = transfer();
    fireEvent.dragStart(chip('a'), { dataTransfer: data });
    place(chip('p'));
    expect(fireEvent.dragOver(chip('p'), { dataTransfer: data, clientX: 130 })).toBe(true);
    fireEvent.drop(chip('p'), { dataTransfer: data, clientX: 130 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('ignores drags that did not start on one of its chips', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    place(chip('c'));
    expect(fireEvent.dragOver(chip('c'), { dataTransfer: transfer(), clientX: 130 })).toBe(true);
    fireEvent.drop(chip('c'), { dataTransfer: transfer(), clientX: 130 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('refuses a foreign drag even when a chip drag never reported its end', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    // A chip drag starts, and its dragend is lost (the chip remounted mid-drag).
    fireEvent.dragStart(chip('a'), { dataTransfer: transfer() });
    const file = { ...transfer(), types: ['Files'] };
    place(chip('c'));
    expect(fireEvent.dragOver(chip('c'), { dataTransfer: file, clientX: 130 })).toBe(true);
    expect(chip('c')).not.toHaveAttribute('data-drop-side');
    fireEvent.drop(chip('c'), { dataTransfer: file, clientX: 130 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('clears all marks when the drag is cancelled', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    const data = transfer();
    fireEvent.dragStart(chip('a'), { dataTransfer: data });
    place(chip('c'));
    fireEvent.dragOver(chip('c'), { dataTransfer: data, clientX: 130 });
    fireEvent.dragEnd(chip('a'), { dataTransfer: data });
    expect(chip('a')).not.toHaveAttribute('data-chip-dragging');
    expect(chip('c')).not.toHaveAttribute('data-drop-side');
    // A later drop without a new drag start does nothing.
    fireEvent.drop(chip('c'), { dataTransfer: data, clientX: 130 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('clears the drop mark when the pointer leaves the chip', () => {
    render(<Harness onMove={vi.fn()} />);
    const data = transfer();
    fireEvent.dragStart(chip('a'), { dataTransfer: data });
    place(chip('c'));
    fireEvent.dragOver(chip('c'), { dataTransfer: data, clientX: 130 });
    fireEvent.dragLeave(chip('c'), { dataTransfer: data, relatedTarget: chip('c').firstChild });
    expect(chip('c')).toHaveAttribute('data-drop-side', 'after');
    fireEvent.dragLeave(chip('c'), { dataTransfer: data, relatedTarget: document.body });
    expect(chip('c')).not.toHaveAttribute('data-drop-side');
  });

  it('mirrors the drop side in right-to-left layouts', () => {
    document.documentElement.setAttribute('dir', 'rtl');
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    const data = transfer();
    fireEvent.dragStart(chip('a'), { dataTransfer: data });
    place(chip('c'));
    fireEvent.dragOver(chip('c'), { dataTransfer: data, clientX: 105 });
    expect(chip('c')).toHaveAttribute('data-drop-side', 'after');
    fireEvent.drop(chip('c'), { dataTransfer: data, clientX: 135 });
    expect(onMove).toHaveBeenCalledExactlyOnceWith('a', 'c', 'before');
  });

  it('logs a failed move and stays usable', () => {
    const warn = mockConsoleWarn();
    const onMove = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('quota');
      })
      .mockImplementation(() => undefined);
    render(<Harness onMove={onMove} />);
    const data = transfer();
    fireEvent.dragStart(chip('a'), { dataTransfer: data });
    place(chip('c'));
    fireEvent.dragOver(chip('c'), { dataTransfer: data, clientX: 130 });
    fireEvent.drop(chip('c'), { dataTransfer: data, clientX: 130 });
    expect(warn.spy).toHaveBeenCalledWith(
      expect.stringContaining('[useChipDragReorder] move failed'),
    );
    expect(chip('a')).not.toHaveAttribute('data-chip-dragging');
    fireEvent.dragStart(chip('b'), { dataTransfer: data });
    fireEvent.dragOver(chip('c'), { dataTransfer: data, clientX: 130 });
    fireEvent.drop(chip('c'), { dataTransfer: data, clientX: 130 });
    expect(onMove).toHaveBeenLastCalledWith('b', 'c', 'after');
  });
});
