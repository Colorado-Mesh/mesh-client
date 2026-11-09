import { type RefObject, useCallback, useEffect, useRef } from 'react';

export const MODAL_FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface UseModalFocusTrapOptions {
  /** When false, do not attach listeners or move focus. Default true. */
  enabled?: boolean;
}

export interface UseModalFocusTrapResult {
  /** Call before closing into another dialog or chat so cleanup does not steal focus. */
  suppressRestoreFocus: () => void;
}

/**
 * Mount-once (per enabled cycle) modal focus: move into the panel, Tab-cycle
 * within it, Escape → onEscape, restore prior focus on close when appropriate.
 * Keeps the latest onEscape in a ref so inline parent callbacks do not re-focus.
 */
export function useModalFocusTrap(
  panelRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  options?: UseModalFocusTrapOptions,
): UseModalFocusTrapResult {
  const enabled = options?.enabled !== false;
  const onEscapeRef = useRef(onEscape);
  const restoreFocusRef = useRef(true);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  const suppressRestoreFocus = useCallback(() => {
    restoreFocusRef.current = false;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const panel = panelRef.current;
    if (!panel) return;

    restoreFocusRef.current = true;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusOpts = { preventScroll: true } as const;
    // Do not filter on offsetParent — jsdom reports null for visible controls.
    const focusables = () => [...panel.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)];

    focusables()[0]?.focus(focusOpts);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const nodes = focusables();
      if (nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus(focusOpts);
        }
      } else if (active === last || !panel.contains(active)) {
        e.preventDefault();
        first.focus(focusOpts);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (!restoreFocusRef.current) return;
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus(focusOpts);
      }
    };
  }, [enabled, panelRef]);

  return { suppressRestoreFocus };
}
