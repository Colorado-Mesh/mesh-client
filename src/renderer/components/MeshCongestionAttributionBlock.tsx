import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type {
  CongestionLine,
  RfDuplicateOriginator,
} from '../lib/diagnostics/meshCongestionAttribution';
import { getRoleInfo } from '../lib/roleInfo';
import type { MeshNode } from '../lib/types';

function renderCongestionLine(line: CongestionLine, t: TFunction) {
  switch (line.key) {
    case 'partialSamples':
      return t('meshCongestion.partialSamples', line.values);
    case 'insufficientEvidence':
      return t('meshCongestion.insufficientEvidence');
    case 'routingAnomalies':
      return t('meshCongestion.routingAnomalies');
    case 'pathMixMqttCausal':
      return t('meshCongestion.pathMixMqttCausal', line.values);
    case 'pathMixMqttHeavy':
      return t('meshCongestion.pathMixMqttHeavy', line.values);
    case 'pathMixRfOnly':
      return t('meshCongestion.pathMixRfOnly', line.values);
    default: {
      const _u: never = line;
      return _u;
    }
  }
}

interface Props {
  lines: CongestionLine[];
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
  const { t } = useTranslation();
  if (lines.length === 0 && originators.length === 0) return null;

  return (
    <div className={`${className} bg-primary-dark rounded-lg border border-orange-500/20 p-3`}>
      <div className="mb-2 text-xs font-medium text-orange-300">
        {t('meshCongestion.blockTitle')}
      </div>
      {scopeSubtitle && <div className="text-muted mb-2 text-[10px]">{scopeSubtitle}</div>}
      {lines.length > 0 && (
        <div className="text-muted flex flex-col gap-2 text-[10px]">
          {lines.map((line, j) => (
            <p key={j} className="leading-relaxed">
              {renderCongestionLine(line, t)}
            </p>
          ))}
        </div>
      )}
      {originators.length > 0 && (
        <div className={lines.length > 0 ? 'mt-3 border-t border-orange-500/20 pt-2' : ''}>
          <div className="mb-1.5 text-[10px] font-medium text-orange-200/90">
            {t('meshCongestion.mostDuplicateProneTitle')}
          </div>
          <ul className="space-y-1">
            {originators.map((o) => {
              const n = nodes?.get(o.nodeId);
              const name = n?.short_name || n?.long_name || `!${o.nodeId.toString(16)}`;
              const role = getRoleInfo(n?.role);
              return (
                <li key={o.nodeId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-gray-300">{name}</span>
                  <span className="text-gray-500">
                    ({t(role.labelKey, role.labelParams ?? undefined)})
                  </span>
                  <span className="text-gray-600">
                    +{o.echoScore}{' '}
                    {o.echoScore === 1
                      ? t('meshCongestion.extraRfReception')
                      : t('meshCongestion.extraRfReceptions')}{' '}
                    · {o.recordCount}{' '}
                    {o.recordCount === 1
                      ? t('meshCongestion.originatorPacket')
                      : t('meshCongestion.originatorPackets')}
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
