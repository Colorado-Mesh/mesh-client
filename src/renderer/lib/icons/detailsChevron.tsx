import { ChevronDown } from 'lucide-react-motion';

import { useIconTrigger } from '@/renderer/lib/icons/iconMotionContext';

/** Chevron for `<details>` summary rows — rotates when open via Tailwind `group-open`. */
export function DetailsChevron({ className }: { className?: string }) {
  const trigger = useIconTrigger();
  return (
    <ChevronDown
      aria-hidden
      className={className ?? 'text-muted h-4 w-4 transition-transform group-open:rotate-180'}
      trigger={trigger}
      size={16}
    />
  );
}
