const HUB_RADIUS = 300;
const OUTER_NODES = Array.from({ length: 6 }, (_, i) => {
  const angle = ((-90 + 60 * i) * Math.PI) / 180;
  return { x: 512 + HUB_RADIUS * Math.cos(angle), y: 512 + HUB_RADIUS * Math.sin(angle) };
});

/** Mesh Hub logo mark (a hub node linked to a ring of mesh nodes); decorative, so aria-hidden. */
export function MeshHubMark() {
  return (
    <svg
      className="cm-brand-mark"
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g className="cm-brand-mark-stroke" strokeWidth={40} strokeLinecap="round" opacity={0.8}>
        {OUTER_NODES.map((node, i) => {
          const next = OUTER_NODES[(i + 1) % OUTER_NODES.length];
          return (
            <g key={i}>
              <line x1={node.x} y1={node.y} x2={next.x} y2={next.y} />
              <line x1={512} y1={512} x2={node.x} y2={node.y} />
            </g>
          );
        })}
      </g>
      <g className="cm-brand-mark-sun">
        {OUTER_NODES.map((node, i) => (
          <circle key={i} cx={node.x} cy={node.y} r={56} />
        ))}
        <circle cx={512} cy={512} r={104} />
      </g>
      <circle className="cm-brand-mark-core" cx={512} cy={512} r={44} />
    </svg>
  );
}
