import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/renderer/components/Toast';
import { buttonClassName } from '@/renderer/components/ui/Button';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useTeamRosterStore } from '@/renderer/stores/teamRosterStore';
import type { TeamMember } from '@/shared/teamRosterTypes';
import { normalizeTeamColor } from '@/shared/teamRosterTypes';

import { TeamContactEditorDialog } from './TeamContactEditorDialog';
import { TeamProtocolBadges } from './TeamProtocolBadges';

/** Network panel: compact operational list of contact cards opted into the roster. */
export default function TeamRosterPanel() {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const members = useTeamRosterStore((s) => s.members);
  const upsertMember = useTeamRosterStore((s) => s.upsertMember);
  const rosterMembers = useMemo(() => members.filter((m) => m.onRoster), [members]);
  const offRosterMembers = useMemo(() => members.filter((m) => !m.onRoster), [members]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyUnitId, setBusyUnitId] = useState<number | null>(null);
  const pickerTitleId = useId();

  const addMemberToRoster = async (member: TeamMember) => {
    setBusyUnitId(member.unitId);
    try {
      await upsertMember({
        unitId: member.unitId,
        callsign: member.callsign,
        isSelf: member.isSelf,
        onRoster: true,
      });
    } catch (err: unknown) {
      console.warn('[TeamRoster] add failed ' + errLikeToLogString(err));
      addToast(t('teamRoster.saveFailed'), 'error');
    } finally {
      setBusyUnitId(null);
    }
  };

  const removeMemberFromRoster = async (member: TeamMember) => {
    setBusyUnitId(member.unitId);
    try {
      await upsertMember({
        unitId: member.unitId,
        callsign: member.callsign,
        isSelf: member.isSelf,
        onRoster: false,
      });
    } catch (err: unknown) {
      console.warn('[TeamRoster] remove failed ' + errLikeToLogString(err));
      addToast(t('teamRoster.saveFailed'), 'error');
    } finally {
      setBusyUnitId(null);
    }
  };

  return (
    <section
      aria-labelledby="team-roster-title"
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex max-w-prose flex-col gap-1">
          <h2 id="team-roster-title" className="text-ink-100 text-base font-semibold">
            {t('teamRoster.rosterTitle')}
          </h2>
          <p className="text-ink-300 text-label">{t('teamRoster.rosterIntro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClassName('secondary', 'md')}
            aria-label={t('teamRoster.addExistingToRoster')}
            onClick={() => {
              setPickerOpen(true);
            }}
          >
            {t('teamRoster.addExistingToRoster')}
          </button>
          <button
            type="button"
            className={buttonClassName('primary', 'md')}
            aria-label={t('teamRoster.createOnRoster')}
            onClick={() => {
              setCreating(true);
            }}
          >
            {t('teamRoster.createOnRoster')}
          </button>
        </div>
      </div>

      {rosterMembers.length === 0 ? (
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
                <th scope="col" className="px-2 py-1.5 font-medium">
                  <span className="sr-only">{t('teamRoster.rosterActions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rosterMembers.map((member) => {
                const swatch = normalizeTeamColor(member.color);
                return (
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
                    <td className="text-ink-100 px-2 py-2 text-sm">
                      <span className="inline-flex items-center gap-2">
                        {swatch ? (
                          <span
                            className="rounded-badge border-ink-600 inline-block h-3 w-3 shrink-0 border"
                            style={{ backgroundColor: swatch }}
                            aria-hidden
                          />
                        ) : null}
                        {member.callsign}
                      </span>
                    </td>
                    <td className="text-ink-300 px-2 py-2 text-sm">{member.role ?? '—'}</td>
                    <td className="px-2 py-2">
                      <TeamProtocolBadges links={member.links} />
                    </td>
                    <td className="px-2 py-2 text-end">
                      <button
                        type="button"
                        className={buttonClassName('secondary', 'sm')}
                        disabled={busyUnitId === member.unitId}
                        aria-label={t('teamRoster.removeFromRosterAria')}
                        onClick={() => {
                          void removeMemberFromRoster(member);
                        }}
                      >
                        {t('teamRoster.removeFromRoster')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={pickerTitleId}
            className="border-ink-600 bg-ink-900 rounded-modal shadow-level-3 flex max-h-[90vh] w-full max-w-md flex-col border p-4"
          >
            <h2 id={pickerTitleId} className="text-ink-100 mb-3 text-base font-semibold">
              {t('teamRoster.addExistingToRoster')}
            </h2>
            {offRosterMembers.length === 0 ? (
              <p className="text-ink-400 text-label">{t('teamRoster.noCardsOffRoster')}</p>
            ) : (
              <ul
                className="border-ink-700 max-h-64 overflow-y-auto rounded border"
                aria-label={t('teamRoster.selectContactAria')}
              >
                {offRosterMembers.map((member) => (
                  <li key={member.unitId}>
                    <button
                      type="button"
                      className="hover:bg-ink-800 text-ink-200 w-full px-3 py-2 text-left text-sm"
                      disabled={busyUnitId === member.unitId}
                      aria-label={t('teamRoster.addToRosterAria')}
                      onClick={() => {
                        // Keep picker open so operators can add several cards.
                        void addMemberToRoster(member);
                      }}
                    >
                      #{member.unitId} {member.callsign}
                      {member.role ? ` · ${member.role}` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className={buttonClassName('secondary', 'md')}
                onClick={() => {
                  setPickerOpen(false);
                }}
              >
                {t('teamRoster.cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {creating ? (
        <TeamContactEditorDialog
          member={null}
          defaultOnRoster
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
    </section>
  );
}
