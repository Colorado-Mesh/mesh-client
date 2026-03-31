import { rssiToSignalLevel } from '../lib/signal';

// Exported for reuse wherever a "directly connected" indicator is needed
export function LinkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      stroke="#4ade80"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </svg>
  );
}

interface Props {
  rssi: number | null | undefined;
  isSelf?: boolean;
  className?: string;
}

const BAR_HEIGHTS = [3, 6, 9, 12];
const FILLED_COLOR = '#4ade80';
const UNFILLED_COLOR = '#374151';
const NO_DATA_COLOR = '#4b5563';

export default function SignalBars({ rssi, isSelf, className }: Props) {
  if (isSelf) {
    return <LinkIcon className={className ?? 'h-4 w-4'} />;
  }

  const level = rssiToSignalLevel(rssi);
  const noData = rssi == null;

  return (
    <svg viewBox="0 0 16 12" width="16" height="12" className={className}>
      {BAR_HEIGHTS.map((h, i) => (
        <rect
          key={i}
          x={i * 4}
          y={12 - h}
          width="3"
          height={h}
          fill={noData ? NO_DATA_COLOR : i < level ? FILLED_COLOR : UNFILLED_COLOR}
          rx="0.5"
        />
      ))}
    </svg>
  );
}
