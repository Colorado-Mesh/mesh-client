import type { ReactNode, WheelEvent } from 'react';
import { useEffect, useRef } from 'react';

/** Space kept beside the active item after scrolling it into view. */
const ACTIVE_ITEM_MARGIN_PX = 8;

export interface ScrollStripProps {
  'aria-label': string;
  /** Changes when the active item changes; the item marked `data-strip-active` scrolls into view. */
  activeKey?: string | number | null;
  children: ReactNode;
  className?: string;
}

/**
 * One row of chips that scrolls sideways instead of wrapping (chat channels, DM tabs). The height
 * never grows with the item count; a vertical mouse wheel scrolls it horizontally.
 */
export function ScrollStrip({
  'aria-label': ariaLabel,
  activeKey,
  children,
  className,
}: ScrollStripProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Adjust only this strip's scrollLeft: scrollIntoView could also scroll the page or the
  // virtualized message list around it.
  useEffect(() => {
    if (activeKey === undefined || activeKey === null) return;
    const strip = ref.current;
    const item = strip?.querySelector<HTMLElement>('[data-strip-active="true"]');
    if (!strip || !item) return;
    const stripBox = strip.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    if (itemBox.left < stripBox.left) {
      strip.scrollLeft -= stripBox.left - itemBox.left + ACTIVE_ITEM_MARGIN_PX;
    } else if (itemBox.right > stripBox.right) {
      strip.scrollLeft += itemBox.right - stripBox.right + ACTIVE_ITEM_MARGIN_PX;
    }
  }, [activeKey]);

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    el.scrollLeft += e.deltaY;
  };

  return (
    <div
      ref={ref}
      role="group"
      aria-label={ariaLabel}
      onWheel={handleWheel}
      className={`flex min-w-0 [scrollbar-width:none] items-center gap-1.5 overflow-x-auto overflow-y-hidden whitespace-nowrap [&::-webkit-scrollbar]:hidden ${className ?? ''}`}
    >
      {children}
    </div>
  );
}
