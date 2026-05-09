import { useTranslation } from 'react-i18next';

import {
  BATTERY_GAUGE_TIER_FILL_CLASS,
  batteryGaugeFilledBars,
  batteryGaugeTier,
} from '@/renderer/lib/batteryGaugeUtils';

interface Props {
  percent: number;
  charging?: boolean;
}

export default function ConnectionBatteryGauge({ percent, charging }: Props) {
  const { t } = useTranslation();
  const tier = batteryGaugeTier(percent);
  const filled = batteryGaugeFilledBars(percent);
  const fillClass = BATTERY_GAUGE_TIER_FILL_CLASS[tier];

  return (
    <div
      className="inline-flex items-center gap-2"
      role="img"
      aria-label={t(charging ? 'battery.percentCharging' : 'battery.percent', { percent })}
    >
      <div className="flex items-center gap-0.5" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-3 w-2 shrink-0 overflow-hidden rounded-sm border border-gray-600/90 bg-gray-800/50"
          >
            {i < filled ? <div className={`h-full w-full ${fillClass}`} /> : null}
          </div>
        ))}
      </div>
      {charging ? (
        <svg
          className="h-4 w-4 shrink-0 text-green-500"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 0 011.09-.106z"
            clipRule="evenodd"
          />
        </svg>
      ) : null}
    </div>
  );
}
