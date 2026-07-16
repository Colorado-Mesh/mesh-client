import type { RrcSessionStatus } from '@/shared/rrc-types';

/** True when a hub session already owns a Link (or is establishing one). */
export function isRrcHubLinked(status: RrcSessionStatus | null | undefined): boolean {
  return (
    status === 'connecting' ||
    status === 'awaiting_welcome' ||
    status === 'active' ||
    status === 'reconnecting'
  );
}
