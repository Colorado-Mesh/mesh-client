import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react-motion';

import { useIconTrigger } from '@/renderer/lib/icons/iconMotionContext';

export type SortDirection = 'asc' | 'desc';

/**
 * Sort state for a table column header: up-down arrows while the column is not sorted, then a
 * single arrow for the direction. Arrows rather than chevrons, so a sorted header never reads as a
 * dropdown. The header cell carries `aria-sort`; the icon is decorative.
 */
export function SortIndicator({ direction }: { direction: SortDirection | null }) {
  const trigger = useIconTrigger();
  const props = { 'aria-hidden': true as const, trigger, size: 12 };
  if (direction === null) {
    return <ArrowUpDown {...props} data-sort="none" className="text-ink-600 ml-1 inline h-3 w-3" />;
  }
  const Icon = direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <Icon {...props} data-sort={direction} className="text-bright-green ml-1 inline h-3 w-3" />
  );
}
