import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  attachGlobalInstantTooltipListeners,
  instantTooltipSide,
} from '@/renderer/lib/globalInstantTooltip';
import {
  computeInstantTooltipPosition,
  type InstantTooltipPosition,
} from '@/renderer/lib/instantTooltipPosition';

import { InstantTooltipBubble } from './InstantTooltipBubble';

function positionFor(host: HTMLElement): InstantTooltipPosition {
  return computeInstantTooltipPosition(host.getBoundingClientRect(), instantTooltipSide(host));
}

/**
 * App-wide instant tooltips for native `title` attributes (Electron delays native titles).
 * Mount once near the app root; HelpTooltip uses its own handler and opts out via
 * `data-instant-tooltip-managed`.
 */
export function GlobalInstantTooltip() {
  const [state, setState] = useState<{ text: string; pos: InstantTooltipPosition } | null>(null);

  useEffect(() => {
    return attachGlobalInstantTooltipListeners({
      onShow: (host, text) => {
        setState({ text, pos: positionFor(host) });
      },
      onHide: () => {
        setState(null);
      },
      onReposition: (host) => {
        setState((prev) => (prev ? { ...prev, pos: positionFor(host) } : null));
      },
    });
  }, []);

  if (!state) return null;
  return createPortal(<InstantTooltipBubble text={state.text} pos={state.pos} />, document.body);
}
