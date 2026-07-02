import type { ReactNode } from 'react';
import { useRef, useState } from 'react';

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
}: {
  text: string;
  children?: ReactNode;
  /** Extra classes on the wrapper (e.g. `shrink-0` in toolbars). */
  className?: string;
  /** Accessible name when custom children replace the default ⓘ trigger. */
  ariaLabel?: string;
}) {
  const [pos, setPos] = useState<InstantTooltipPosition | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const updatePosition = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos(computeInstantTooltipPosition(r));
  };
  return (
    <span
      ref={ref}
      data-instant-tooltip-managed=""
      className={`inline-flex cursor-help${className ? ` ${className}` : ''}`}
      aria-label={ariaLabel}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard focus shows same tooltip as hover
      tabIndex={0}
      onMouseEnter={updatePosition}
      onMouseLeave={() => {
        setPos(null);
      }}
      onFocus={updatePosition}
      onBlur={() => {
        setPos(null);
      }}
    >
      {children ?? <span className="text-xs text-gray-500 select-none">ⓘ</span>}
      {pos && <InstantTooltipBubble text={text} pos={pos} />}
    </span>
  );
}
