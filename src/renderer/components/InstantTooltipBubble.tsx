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
      className="pointer-events-none w-64 rounded border border-gray-600 bg-gray-800 px-2.5 py-1.5 text-xs whitespace-pre-wrap text-gray-200 shadow-lg"
    >
      {text}
    </span>
  );
}
