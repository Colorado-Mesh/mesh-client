import { useLayoutEffect, useRef } from 'react';

import {
  clampCenteredTooltipLeft,
  type InstantTooltipPosition,
} from '@/renderer/lib/instantTooltipPosition';
import { Z_INSTANT_TOOLTIP } from '@/renderer/lib/modalZIndex';

const TRANSFORM: Record<InstantTooltipPosition['placement'], string> = {
  above: 'translate(-50%, -100%)',
  below: 'translate(-50%, 0)',
  right: 'translate(0, -50%)',
};

export function InstantTooltipBubble({ text, pos }: { text: string; pos: InstantTooltipPosition }) {
  const ref = useRef<HTMLSpanElement>(null);

  // The bubble is as wide as its text, up to max-w-64, so a centred one is kept on screen only
  // after it has been measured. This runs before paint.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || pos.placement === 'right') return;
    el.style.left = `${clampCenteredTooltipLeft(pos.left, el.offsetWidth, window.innerWidth)}px`;
    el.style.transform = pos.placement === 'above' ? 'translateY(-100%)' : 'none';
  }, [text, pos]);

  return (
    <span
      ref={ref}
      role="tooltip"
      data-placement={pos.placement}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        transform: TRANSFORM[pos.placement],
        zIndex: Z_INSTANT_TOOLTIP,
      }}
      className="shadow-level-3 border-ink-600 bg-ink-800 text-ink-200 pointer-events-none w-max max-w-64 rounded border px-2.5 py-1.5 text-xs whitespace-pre-wrap"
    >
      {text}
    </span>
  );
}
