import { useTranslation } from 'react-i18next';

import type { MeshProtocol } from '@/shared/meshProtocol';
import type { TeamMemberLink } from '@/shared/teamRosterTypes';

const PROTOCOL_BADGE_CLASS: Record<MeshProtocol, string> = {
  meshtastic: 'bg-meshtastic-700 text-white',
  meshcore: 'bg-meshcore-700 text-white',
  reticulum: 'bg-reticulum-700 text-white',
};

export const TEAM_PROTOCOL_LABEL_KEYS: Record<MeshProtocol, string> = {
  meshtastic: 'teamRoster.protocolMeshtastic',
  meshcore: 'teamRoster.protocolMeshcore',
  reticulum: 'teamRoster.protocolReticulum',
};

export function TeamProtocolBadges({ links }: { links: TeamMemberLink[] }) {
  const { t } = useTranslation();
  if (links.length === 0) {
    return <span className="text-ink-400 text-label">{t('teamRoster.noLinks')}</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1" aria-label={t('teamRoster.linkedProtocols')}>
      {links.map((link) => (
        <li key={link.protocol}>
          <span
            className={`rounded-badge text-2xs inline-flex px-1.5 py-0.5 font-medium ${PROTOCOL_BADGE_CLASS[link.protocol]}`}
            title={link.longName ?? link.durableKey}
          >
            {t(TEAM_PROTOCOL_LABEL_KEYS[link.protocol])}
          </span>
        </li>
      ))}
    </ul>
  );
}
