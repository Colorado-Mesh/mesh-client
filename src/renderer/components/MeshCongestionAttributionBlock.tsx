import type { RfDuplicateOriginator } from '../lib/diagnostics/meshCongestionAttribution';
import { getRoleInfo } from '../lib/roleInfo';
import type { MeshNode } from '../lib/types';

interface Props {
  lines: string[];
  originators: RfDuplicateOriginator[];
  nodes?: Map<number, MeshNode>;
  /** Shown under the main title when set (e.g. "Observed at this client"). */
  scopeSubtitle?: string;
  /** Outer wrapper margin; default mt-3 for node detail context. */
  className?: string;
}

export default function MeshCongestionAttributionBlock({
  lines,
  originators,
  nodes,
  scopeSubtitle,
  className = 'mt-3',
}: Props) {
  if (lines.length === 0 && originators.length === 0) return null;

  return (
    <div className={`${className} bg-primary-dark rounded-lg border border-orange-500/20 p-3`}>
      <div className="mb-2 text-xs font-medium text-orange-300">
        Why you&apos;re seeing duplicate traffic
      </div>
      {scopeSubtitle && <div className="text-muted mb-2 text-[10px]">{scopeSubtitle}</div>}
      {lines.length > 0 && (
        <div className="text-muted flex flex-col gap-2 text-[10px]">
          {lines.map((line, j) => (
            <p key={j} className="leading-relaxed">
              {line}
            </p>
          ))}
        </div>
      )}
      {originators.length > 0 && (
        <div className={lines.length > 0 ? 'mt-3 border-t border-orange-500/20 pt-2' : ''}>
          <div className="mb-1.5 text-[10px] font-medium text-orange-200/90">
            Most RF duplicate-prone traffic lately (by originator — not which relay)
          </div>
          <ul className="space-y-1">
            {originators.map((o) => {
              const n = nodes?.get(o.nodeId);
              const name = n?.short_name || n?.long_name || `!${o.nodeId.toString(16)}`;
              const roleLabel = getRoleInfo(n?.role).label;
              return (
                <li key={o.nodeId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-gray-300">{name}</span>
                  <span className="text-gray-500">({roleLabel})</span>
                  <span className="text-gray-600">
                    +{o.echoScore} extra RF reception{o.echoScore !== 1 ? 's' : ''} ·{' '}
                    {o.recordCount} packet{o.recordCount !== 1 ? 's' : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
