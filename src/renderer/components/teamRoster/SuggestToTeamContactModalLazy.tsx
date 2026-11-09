import { lazy, Suspense } from 'react';

import type { TeamLinkCandidate } from '@/renderer/lib/teamRoster/durableKey';

const SuggestToTeamContactModal = lazy(() =>
  import('./SuggestToTeamContactModal').then((m) => ({
    default: m.SuggestToTeamContactModal,
  })),
);

/** Loads the suggest modal chunk only when a candidate is open. */
export function SuggestToTeamContactModalLazy({
  candidate,
  onClose,
  preferSelf = false,
}: {
  candidate: TeamLinkCandidate;
  onClose: () => void;
  preferSelf?: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <SuggestToTeamContactModal candidate={candidate} onClose={onClose} preferSelf={preferSelf} />
    </Suspense>
  );
}
