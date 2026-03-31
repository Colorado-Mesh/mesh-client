import type { ReactNode } from 'react';
import { useRef, useState } from 'react';

const TOOLTIP_WIDTH = 256; // w-64
const TOOLTIP_MARGIN = 8;

export function HelpTooltip({ text, children }: { text: string; children?: ReactNode }) {
  const [pos, setPos] = useState<{ top: number; left: number; below: boolean } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const updatePosition = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const centeredLeft = r.left + r.width / 2;
    const clampedLeft = Math.max(
      TOOLTIP_WIDTH / 2 + TOOLTIP_MARGIN,
      Math.min(window.innerWidth - TOOLTIP_WIDTH / 2 - TOOLTIP_MARGIN, centeredLeft),
    );
    const below = r.top < 80;
    setPos({ top: below ? r.bottom + 4 : r.top - 8, left: clampedLeft, below });
  };
  return (
    <span
      ref={ref}
      className="inline-flex cursor-help"
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
      {pos && (
        <span
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            transform: pos.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
            zIndex: 9999,
          }}
          className="pointer-events-none w-64 rounded border border-gray-600 bg-gray-800 px-2.5 py-1.5 text-xs text-gray-200 shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
