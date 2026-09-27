import type { InstantTooltipPosition } from '@/renderer/lib/instantTooltipPosition';
import { Z_INSTANT_TOOLTIP } from '@/renderer/lib/modalZIndex';

export function InstantTooltipBubble({ text, pos }: { text: string; pos: InstantTooltipPosition }) {
  return (
    <span
      role="tooltip"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        transform: pos.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
        zIndex: Z_INSTANT_TOOLTIP,
      }}
      className="shadow-level-3 border-ink-600 bg-ink-800 text-ink-200 pointer-events-none w-64 rounded border px-2.5 py-1.5 text-xs whitespace-pre-wrap"
    >
      {text}
    </span>
  );
}
