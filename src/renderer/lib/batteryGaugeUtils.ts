/** Tier colors for the connection-panel 5-bar battery gauge (0–100%). */
export type BatteryGaugeTier = 'red' | 'orange' | 'yellow' | 'blue' | 'green';

/**
 * Map battery percent to a display tier.
 * ≤10 red; >10 & <30 orange; ≥30 & <50 yellow; ≥50 & <80 blue; ≥80 green.
 */
export function batteryGaugeTier(percent: number): BatteryGaugeTier {
  const p = Math.min(100, Math.max(0, percent));
  if (p <= 10) return 'red';
  if (p < 30) return 'orange';
  if (p < 50) return 'yellow';
  if (p < 80) return 'blue';
  return 'green';
}

/** How many of the 5 horizontal segments are filled (each segment ≈20%). */
export function batteryGaugeFilledBars(percent: number): number {
  const p = Math.min(100, Math.max(0, percent));
  return Math.min(5, Math.max(0, Math.ceil(p / 20)));
}

export const BATTERY_GAUGE_TIER_FILL_CLASS: Record<BatteryGaugeTier, string> = {
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-400',
  blue: 'bg-blue-500',
  green: 'bg-green-500',
};
