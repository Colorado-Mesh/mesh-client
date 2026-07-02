/** Stored title while the native attribute is removed to suppress OS tooltip delay. */
export const INSTANT_TOOLTIP_STORED_ATTR = 'data-instant-tooltip-stored';

export function findInstantTooltipHost(start: EventTarget | null): HTMLElement | null {
  if (!(start instanceof Element)) return null;
  if (start.closest('[data-instant-tooltip-managed]')) return null;
  if (start.closest('[data-no-instant-tooltip]')) return null;

  let el: Element | null = start;
  while (el && el !== document.documentElement) {
    if (el instanceof HTMLElement) {
      const title = el.getAttribute('title');
      if (title?.trim()) return el;
    }
    el = el.parentElement;
  }
  return null;
}

function restoreNativeTitle(host: HTMLElement): void {
  const stored = host.getAttribute(INSTANT_TOOLTIP_STORED_ATTR);
  if (stored !== null) {
    host.setAttribute('title', stored);
    host.removeAttribute(INSTANT_TOOLTIP_STORED_ATTR);
  }
}

export interface GlobalInstantTooltipCallbacks {
  onShow: (host: HTMLElement, text: string) => void;
  onHide: () => void;
  onReposition: (host: HTMLElement) => void;
}

/** Document-level delegation: instant tooltips for any element with a `title` attribute. */
export function attachGlobalInstantTooltipListeners(
  callbacks: GlobalInstantTooltipCallbacks,
): () => void {
  let activeHost: HTMLElement | null = null;

  const hide = (): void => {
    if (activeHost) {
      restoreNativeTitle(activeHost);
      activeHost = null;
    }
    callbacks.onHide();
  };

  const show = (host: HTMLElement): void => {
    if (activeHost === host) {
      callbacks.onReposition(host);
      return;
    }
    hide();
    const text = host.getAttribute('title')?.trim();
    if (!text) return;
    host.setAttribute(INSTANT_TOOLTIP_STORED_ATTR, text);
    host.removeAttribute('title');
    activeHost = host;
    callbacks.onShow(host, text);
  };

  const onMouseOver = (event: MouseEvent): void => {
    const host = findInstantTooltipHost(event.target);
    if (host) {
      show(host);
      return;
    }
    if (activeHost && !activeHost.contains(event.target as Node)) {
      hide();
    }
  };

  const onMouseOut = (event: MouseEvent): void => {
    if (!activeHost) return;
    const related = event.relatedTarget;
    if (related instanceof Node && activeHost.contains(related)) return;
    if (event.target === activeHost || activeHost.contains(event.target as Node)) {
      hide();
    }
  };

  const onFocusIn = (event: FocusEvent): void => {
    const host = findInstantTooltipHost(event.target);
    if (host) show(host);
  };

  const onFocusOut = (event: FocusEvent): void => {
    if (!activeHost) return;
    const related = event.relatedTarget;
    if (related instanceof Node && activeHost.contains(related)) return;
    if (event.target === activeHost || activeHost.contains(event.target as Node)) {
      hide();
    }
  };

  const onReposition = (): void => {
    if (activeHost) callbacks.onReposition(activeHost);
  };

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('scroll', onReposition, true);
  window.addEventListener('resize', onReposition);

  return () => {
    hide();
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    window.removeEventListener('scroll', onReposition, true);
    window.removeEventListener('resize', onReposition);
  };
}
