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
}: {
  candidate: TeamLinkCandidate;
  onClose: () => void;
}) {
  return (
    <Suspense fallback={null}>
      <SuggestToTeamContactModal candidate={candidate} onClose={onClose} />
    </Suspense>
  );
}
