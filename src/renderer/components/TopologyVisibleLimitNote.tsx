/**
 * Always-visible Graph / Topology layout-budget note. Labels are passed in because
 * PeerGraphPanel and ReticulumTopologyPanel use different i18n prefixes.
 */
export interface TopologyVisibleLimitNoteProps {
  label: string;
}

export function TopologyVisibleLimitNote({ label }: TopologyVisibleLimitNoteProps) {
  return (
    <span className="text-slate-500" aria-label={label}>
      {label}
    </span>
  );
}
