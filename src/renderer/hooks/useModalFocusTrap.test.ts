import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useModalFocusTrap } from './useModalFocusTrap';

describe('useModalFocusTrap', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('focuses the first control and restores on unmount', () => {
    const prior = document.createElement('button');
    prior.textContent = 'prior';
    document.body.appendChild(prior);
    prior.focus();

    const panel = document.createElement('div');
    const first = document.createElement('button');
    first.textContent = 'first';
    const second = document.createElement('button');
    second.textContent = 'second';
    panel.append(first, second);
    document.body.appendChild(panel);

    const panelRef = createRef<HTMLDivElement>();
    Object.defineProperty(panelRef, 'current', { value: panel, writable: true });
    const onEscape = vi.fn();

    const { unmount } = renderHook(() => useModalFocusTrap(panelRef, onEscape));
    expect(document.activeElement).toBe(first);

    unmount();
    expect(document.activeElement).toBe(prior);
  });

  it('skips restore when suppressRestoreFocus was called', () => {
    const prior = document.createElement('button');
    document.body.appendChild(prior);
    prior.focus();

    const panel = document.createElement('div');
    const first = document.createElement('button');
    panel.appendChild(first);
    document.body.appendChild(panel);

    const panelRef = createRef<HTMLDivElement>();
    Object.defineProperty(panelRef, 'current', { value: panel, writable: true });

    const { result, unmount } = renderHook(() => useModalFocusTrap(panelRef, () => {}));
    result.current.suppressRestoreFocus();
    unmount();
    expect(document.activeElement).toBe(first);
  });
});
