import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { attachGlobalInstantTooltipListeners } from '@/renderer/lib/globalInstantTooltip';
import {
  computeInstantTooltipPosition,
  type InstantTooltipPosition,
} from '@/renderer/lib/instantTooltipPosition';

import { InstantTooltipBubble } from './InstantTooltipBubble';

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
        setState({ text, pos: computeInstantTooltipPosition(host.getBoundingClientRect()) });
      },
      onHide: () => {
        setState(null);
      },
      onReposition: (host) => {
        setState((prev) =>
          prev
            ? { ...prev, pos: computeInstantTooltipPosition(host.getBoundingClientRect()) }
            : null,
        );
      },
    });
  }, []);

  if (!state) return null;
  return createPortal(<InstantTooltipBubble text={state.text} pos={state.pos} />, document.body);
}
