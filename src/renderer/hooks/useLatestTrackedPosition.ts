import { useShallow } from 'zustand/react/shallow';

import { latestPositionHistoryPoint } from '../lib/coordUtils';
import { usePositionHistoryStore } from '../stores/positionHistoryStore';

/**
 * Latest valid tracked lat/lon for a node from position history.
 * useShallow avoids a new object reference every getSnapshot (React 19 infinite-loop guard).
 */
export function useLatestTrackedPosition(nodeId: number): { lat: number; lon: number } | null {
  return usePositionHistoryStore(
    useShallow((s) => latestPositionHistoryPoint(s.history.get(nodeId))),
  );
}
