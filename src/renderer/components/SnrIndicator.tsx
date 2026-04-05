const BAR_HEIGHTS = [3, 6, 9];
const UNFILLED_COLOR = '#374151';

function snrLevel(snr: number): { level: number; color: string; textClass: string } {
  if (snr >= 5) return { level: 3, color: '#4ade80', textClass: 'text-green-400' };
  if (snr >= 0) return { level: 2, color: '#facc15', textClass: 'text-yellow-400' };
  return { level: 1, color: '#f87171', textClass: 'text-red-400' };
}

interface Props {
  snr: number;
  className?: string;
}

export default function SnrIndicator({ snr, className }: Props) {
  const { level, color, textClass } = snrLevel(snr);
  return (
    <span className={`inline-flex items-center gap-1 font-mono ${textClass} ${className ?? ''}`}>
      <svg viewBox="0 0 12 9" width="12" height="9">
        {BAR_HEIGHTS.map((h, i) => (
          <rect
            key={i}
            x={i * 4}
            y={9 - h}
            width="3"
            height={h}
            fill={i < level ? color : UNFILLED_COLOR}
            rx="0.5"
          />
        ))}
      </svg>
      {snr > 0 ? '+' : ''}
      {snr.toFixed(1)} dB
    </span>
  );
}
