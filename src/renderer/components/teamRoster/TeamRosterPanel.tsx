import { useTranslation } from 'react-i18next';

import { useTeamRosterStore } from '@/renderer/stores/teamRosterStore';

import { TeamProtocolBadges } from './TeamProtocolBadges';

/** Network panel: compact operational list of team contacts by Unit ID. */
export default function TeamRosterPanel() {
  const { t } = useTranslation();
  const members = useTeamRosterStore((s) => s.members);

  return (
    <section
      aria-labelledby="team-roster-title"
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3"
    >
      <div className="flex max-w-prose flex-col gap-1">
        <h2 id="team-roster-title" className="text-ink-100 text-base font-semibold">
          {t('teamRoster.rosterTitle')}
        </h2>
        <p className="text-ink-300 text-label">{t('teamRoster.rosterIntro')}</p>
      </div>

      {members.length === 0 ? (
        <p className="text-ink-400 text-label">{t('teamRoster.emptyRoster')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] border-collapse text-left">
            <thead>
              <tr className="border-ink-700 text-ink-300 text-label border-b">
                <th scope="col" className="px-2 py-1.5 font-medium">
                  {t('teamRoster.unitId')}
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  {t('teamRoster.callsign')}
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  {t('teamRoster.role')}
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  {t('teamRoster.linkedProtocols')}
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr
                  key={member.unitId}
                  className={`border-ink-800 border-b ${member.isSelf ? 'bg-brand-green/10' : ''}`}
                >
                  <td className="text-ink-100 px-2 py-2 font-mono text-sm">
                    {member.unitId}
                    {member.isSelf ? (
                      <span className="rounded-badge bg-brand-green text-app-bg text-2xs ml-2 inline-flex px-1.5 py-0.5">
                        {t('teamRoster.selfBadge')}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-ink-100 px-2 py-2 text-sm">{member.callsign}</td>
                  <td className="text-ink-300 px-2 py-2 text-sm">{member.role ?? '—'}</td>
                  <td className="px-2 py-2">
                    <TeamProtocolBadges links={member.links} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
