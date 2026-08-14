/**
 * Shared "show distant peers" + "max hops" filter controls for PeerGraphPanel (Meshtastic/MeshCore)
 * and ReticulumTopologyPanel. Labels are passed in rather than assumed from a translation namespace
 * since the two panels use different i18n key prefixes (`peerGraph.*` vs `reticulumTopology.*`) and
 * intentionally different defaults (see each panel's own `useState` initializer).
 * Numeric Max hops is applied even when Show distant is off; the nearby hop ceiling
 * (Mesh hops > 1, Reticulum hops > 2) applies only when Max hops is All.
 */
export const TOPOLOGY_HOP_FILTER_OPTIONS = [1, 2, 3, 5, 8] as const;

export interface TopologyHopFilterControlsProps {
  includeDistantPeers: boolean;
  onIncludeDistantPeersChange: (value: boolean) => void;
  maxHops: number | null;
  onMaxHopsChange: (value: number | null) => void;
  showDistantPeersLabel: string;
  maxHopsFilterLabel: string;
  maxHopsAllLabel: string;
  maxHopsOptionLabel: (hops: number) => string;
  hopOptions?: readonly number[];
}

export function TopologyHopFilterControls({
  includeDistantPeers,
  onIncludeDistantPeersChange,
  maxHops,
  onMaxHopsChange,
  showDistantPeersLabel,
  maxHopsFilterLabel,
  maxHopsAllLabel,
  maxHopsOptionLabel,
  hopOptions = TOPOLOGY_HOP_FILTER_OPTIONS,
}: TopologyHopFilterControlsProps) {
  return (
    <>
      <label className="flex items-center gap-1.5 text-slate-400">
        <input
          type="checkbox"
          checked={includeDistantPeers}
          onChange={(e) => {
            onIncludeDistantPeersChange(e.target.checked);
          }}
          aria-label={showDistantPeersLabel}
          className="accent-brand-green h-3.5 w-3.5 rounded"
        />
        {showDistantPeersLabel}
      </label>
      <label className="flex items-center gap-1.5 text-slate-400">
        <span>{maxHopsFilterLabel}</span>
        <select
          value={maxHops ?? 'all'}
          onChange={(e) => {
            const value = e.target.value;
            onMaxHopsChange(value === 'all' ? null : Number.parseInt(value, 10));
          }}
          aria-label={maxHopsFilterLabel}
          className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-slate-200"
        >
          <option value="all">{maxHopsAllLabel}</option>
          {hopOptions.map((hops) => (
            <option key={hops} value={hops}>
              {maxHopsOptionLabel(hops)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
