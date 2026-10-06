import { useMemo, useState } from 'react';

import {
  type ChannelRemapContext,
  retainChannelRemapContext,
} from '../lib/remapChannelMessagesToLiveSlots';

/**
 * Slot map used to filter channel history. An empty live list (MeshCore disconnect clears
 * channels) keeps the last radio that published a map until the next one does.
 */
export function useRetainedChannelRemapContext(
  keyByIndex: Readonly<Record<number, string>>,
  radioNodeId: number | null,
): ChannelRemapContext {
  const live = useMemo(() => ({ keyByIndex, radioNodeId }), [keyByIndex, radioNodeId]);
  const [previous, setPrevious] = useState<ChannelRemapContext | null>(null);
  const retained = retainChannelRemapContext(previous, live);
  if (Object.keys(retained.keyByIndex).length > 0 && retained !== previous) {
    setPrevious(retained);
  }
  return retained;
}
