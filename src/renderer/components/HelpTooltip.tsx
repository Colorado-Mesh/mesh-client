import type { ReactNode } from 'react';
import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  computeInstantTooltipPosition,
  type InstantTooltipPosition,
} from '@/renderer/lib/instantTooltipPosition';

import { InstantTooltipBubble } from './InstantTooltipBubble';

export function HelpTooltip({
  text,
  children,
  className,
  ariaLabel,
  /** When true, wrapper is not focusable (use when children are buttons/links). */
  nonFocusableWrapper = false,
}: {
  text: string;
  children?: ReactNode;
  /** Extra classes on the wrapper (e.g. `shrink-0` in toolbars). */
  className?: string;
  /** Accessible name when custom children replace the default ⓘ trigger. */
  ariaLabel?: string;
  nonFocusableWrapper?: boolean;
}) {
  const [pos, setPos] = useState<InstantTooltipPosition | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const descriptionId = useId();
  const updatePosition = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos(computeInstantTooltipPosition(r));
  };
  return (
    <span
      ref={ref}
      data-instant-tooltip-managed=""
      className={['inline-flex', !nonFocusableWrapper && 'cursor-help', className]
        .filter(Boolean)
        .join(' ')}
      aria-label={ariaLabel}
      // Prefer aria-describedby when the bubble is mounted (focus/hover); otherwise keep
      // aria-description so the explanation stays available without a second DOM text node.
      aria-describedby={pos ? descriptionId : undefined}
      aria-description={pos ? undefined : text}
      tabIndex={nonFocusableWrapper ? undefined : 0}
      onMouseEnter={updatePosition}
      onMouseLeave={() => {
        setPos(null);
      }}
      onFocus={updatePosition}
      onBlur={() => {
        setPos(null);
      }}
    >
      {children ?? <span className="text-muted text-xs select-none">ⓘ</span>}
      {pos &&
        createPortal(
          <InstantTooltipBubble id={descriptionId} text={text} pos={pos} />,
          document.body,
        )}
    </span>
  );
}
