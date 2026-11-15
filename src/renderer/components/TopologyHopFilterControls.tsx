/**
 * Shared "max hops" filter control for PeerGraphPanel (Meshtastic/MeshCore)
 * and ReticulumTopologyPanel. Labels are passed in rather than assumed from a translation namespace
 * since the two panels use different i18n key prefixes (`peerGraph.*` vs `reticulumTopology.*`) and
 * intentionally different defaults (see each panel's own `useState` initializer).
 * Show all (`maxHops == null`) includes every peer; numeric Max hops hides peers above that count.
 */
import { topologyHopFilterOptions } from '@/renderer/lib/topologyGraphLimits';

import { SELECT_BOX_SM_CLASS } from './ui/formClasses';

/** Default Meshtastic-shaped presets when callers omit hopOptions. */
export const TOPOLOGY_HOP_FILTER_OPTIONS = topologyHopFilterOptions(7);

export interface TopologyHopFilterControlsProps {
  maxHops: number | null;
  onMaxHopsChange: (value: number | null) => void;
  maxHopsFilterLabel: string;
  maxHopsAllLabel: string;
  maxHopsOptionLabel: (hops: number) => string;
  hopOptions?: readonly number[];
}

export function TopologyHopFilterControls({
  maxHops,
  onMaxHopsChange,
  maxHopsFilterLabel,
  maxHopsAllLabel,
  maxHopsOptionLabel,
  hopOptions = TOPOLOGY_HOP_FILTER_OPTIONS,
}: TopologyHopFilterControlsProps) {
  return (
    <label className="text-ink-400 flex items-center gap-1.5">
      <span>{maxHopsFilterLabel}</span>
      <select
        value={maxHops ?? 'all'}
        onChange={(e) => {
          const value = e.target.value;
          onMaxHopsChange(value === 'all' ? null : Number.parseInt(value, 10));
        }}
        aria-label={maxHopsFilterLabel}
        className={SELECT_BOX_SM_CLASS}
      >
        <option value="all">{maxHopsAllLabel}</option>
        {hopOptions.map((hops) => (
          <option key={hops} value={hops}>
            {maxHopsOptionLabel(hops)}
          </option>
        ))}
      </select>
    </label>
  );
}
