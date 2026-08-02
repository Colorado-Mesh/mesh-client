import { Link2 } from 'lucide-react-motion';

import { useIconTrigger } from '@/renderer/lib/icons/iconMotionContext';

import type { SignalBarLevel } from '../lib/hostLinkQuality';
import { rssiToSignalLevel } from '../lib/signal';

// Exported for reuse wherever a "directly connected" indicator is needed

export function LinkIcon({ className }: { className?: string }) {
  const trigger = useIconTrigger();
  return (
    <Link2
      aria-hidden
      className={className ?? 'h-4 w-4 text-green-400'}
      trigger={trigger}
      size={16}
    />
  );
}

interface Props {
  rssi?: number | null | undefined;
  /**
   * Explicit 0–4 bar level (e.g. IP RTT mapping). When set, overrides `rssi`.
   * Pass with `noData` for grey empty bars (unavailable).
   */
  level?: SignalBarLevel | null;
  /** Force grey empty bars (unknown / unavailable). */
  noData?: boolean;
  isSelf?: boolean;
  className?: string;
}

const BAR_HEIGHTS = [3, 6, 9, 12];
const FILLED_COLOR = '#4ade80';
const UNFILLED_COLOR = '#374151';
const NO_DATA_COLOR = '#4b5563';

export default function SignalBars({ rssi, level, noData, isSelf, className }: Props) {
  if (isSelf) {
    return <LinkIcon className={className ?? 'h-4 w-4'} />;
  }

  const resolvedLevel: SignalBarLevel = level ?? rssiToSignalLevel(rssi);
  const showNoData = noData === true || (level == null && rssi == null);

  return (
    <svg viewBox="0 0 16 12" width="16" height="12" className={className} aria-hidden>
      {BAR_HEIGHTS.map((h, i) => (
        <rect
          key={i}
          x={i * 4}
          y={12 - h}
          width="3"
          height={h}
          fill={showNoData ? NO_DATA_COLOR : i < resolvedLevel ? FILLED_COLOR : UNFILLED_COLOR}
          rx="0.5"
        />
      ))}
    </svg>
  );
}
