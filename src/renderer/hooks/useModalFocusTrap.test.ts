import { renderHook } from '@testing-library/react';
import { createRef, type RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useModalFocusTrap } from './useModalFocusTrap';

function mountPanelWithButtons(labels: string[]): {
  panel: HTMLDivElement;
  buttons: HTMLButtonElement[];
  panelRef: RefObject<HTMLDivElement | null>;
} {
  const panel = document.createElement('div');
  const buttons = labels.map((label) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    panel.appendChild(btn);
    return btn;
  });
  document.body.appendChild(panel);
  const panelRef = createRef<HTMLDivElement>();
  Object.defineProperty(panelRef, 'current', { value: panel, writable: true });
  return { panel, buttons, panelRef };
}

describe('useModalFocusTrap', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('focuses the first control and restores on unmount', () => {
    const prior = document.createElement('button');
    prior.textContent = 'prior';
    document.body.appendChild(prior);
    prior.focus();

    const { buttons, panelRef } = mountPanelWithButtons(['first', 'second']);
    const onEscape = vi.fn();

    const { unmount } = renderHook(() => useModalFocusTrap(panelRef, onEscape));
    expect(document.activeElement).toBe(buttons[0]);

    unmount();
    expect(document.activeElement).toBe(prior);
  });

  it('skips restore when suppressRestoreFocus was called', () => {
    const prior = document.createElement('button');
    document.body.appendChild(prior);
    prior.focus();

    const { buttons, panelRef } = mountPanelWithButtons(['first']);

    const { result, unmount } = renderHook(() => useModalFocusTrap(panelRef, () => {}));
    result.current.suppressRestoreFocus();
    unmount();
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('wraps Tab from the last focusable to the first', () => {
    const { buttons, panelRef } = mountPanelWithButtons(['first', 'second', 'third']);
    renderHook(() => useModalFocusTrap(panelRef, () => {}));
    buttons[2]?.focus();
    expect(document.activeElement).toBe(buttons[2]);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('wraps Shift+Tab from the first focusable to the last', () => {
    const { buttons, panelRef } = mountPanelWithButtons(['first', 'second', 'third']);
    renderHook(() => useModalFocusTrap(panelRef, () => {}));
    expect(document.activeElement).toBe(buttons[0]);

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(buttons[2]);
  });

  it('invokes onEscape once and uses the latest callback after rerender', () => {
    const { panelRef } = mountPanelWithButtons(['first']);
    const firstEscape = vi.fn();
    const secondEscape = vi.fn();

    const { rerender } = renderHook(
      ({ onEscape }: { onEscape: () => void }) => useModalFocusTrap(panelRef, onEscape),
      { initialProps: { onEscape: firstEscape } },
    );

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(firstEscape).toHaveBeenCalledTimes(1);
    expect(secondEscape).not.toHaveBeenCalled();

    rerender({ onEscape: secondEscape });
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(firstEscape).toHaveBeenCalledTimes(1);
    expect(secondEscape).toHaveBeenCalledTimes(1);
  });
});
