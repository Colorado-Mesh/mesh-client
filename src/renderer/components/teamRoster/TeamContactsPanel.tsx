import { Pencil, Trash2 } from 'lucide-react-motion';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/renderer/components/Toast';
import { buttonClassName } from '@/renderer/components/ui/Button';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import { useTeamRosterStore } from '@/renderer/stores/teamRosterStore';
import type { MeshProtocol } from '@/shared/meshProtocol';
import type { TeamMember } from '@/shared/teamRosterTypes';

import { TeamContactEditorDialog } from './TeamContactEditorDialog';
import { TEAM_PROTOCOL_LABEL_KEYS, TeamProtocolBadges } from './TeamProtocolBadges';

/** Network panel: create/edit team contacts and manage protocol links. */
export default function TeamContactsPanel() {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const parentIconTrigger = useParentIconTrigger();
  const members = useTeamRosterStore((s) => s.members);
  const deleteMember = useTeamRosterStore((s) => s.deleteMember);
  const removeLink = useTeamRosterStore((s) => s.removeLink);
  const [editing, setEditing] = useState<TeamMember | null | undefined>(undefined);

  const handleDelete = async (member: TeamMember) => {
    if (!window.confirm(t('teamRoster.deleteConfirm'))) return;
    try {
      await deleteMember(member.unitId);
    } catch (err: unknown) {
      console.warn('[TeamContacts] delete failed ' + errLikeToLogString(err));
      addToast(t('teamRoster.deleteFailed'), 'error');
    }
  };

  const handleUnlink = async (unitId: number, protocol: MeshProtocol) => {
    try {
      await removeLink(unitId, protocol);
    } catch (err: unknown) {
      console.warn('[TeamContacts] unlink failed ' + errLikeToLogString(err));
      addToast(t('teamRoster.unlinkFailed'), 'error');
    }
  };

  return (
    <section
      aria-labelledby="team-contacts-title"
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex max-w-prose flex-col gap-1">
          <h2 id="team-contacts-title" className="text-ink-100 text-base font-semibold">
            {t('teamRoster.contactsTitle')}
          </h2>
          <p className="text-ink-300 text-label">{t('teamRoster.contactsIntro')}</p>
        </div>
        <button
          type="button"
          className={buttonClassName('primary', 'md')}
          aria-label={t('teamRoster.addContact')}
          onClick={() => {
            setEditing(null);
          }}
        >
          {t('teamRoster.addContact')}
        </button>
      </div>

      {members.length === 0 ? (
        <p className="text-ink-400 text-label">{t('teamRoster.emptyContacts')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li
              key={member.unitId}
              className="border-ink-700 bg-ink-900/60 rounded-card flex flex-col gap-2 border p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-ink-100 flex flex-wrap items-center gap-2 font-medium">
                    <span>
                      #{member.unitId} {member.callsign}
                    </span>
                    {member.isSelf ? (
                      <span className="rounded-badge bg-brand-green text-app-bg text-2xs px-1.5 py-0.5">
                        {t('teamRoster.selfBadge')}
                      </span>
                    ) : null}
                  </div>
                  {member.role ? (
                    <p className="text-ink-300 text-label mt-0.5">{member.role}</p>
                  ) : null}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={buttonClassName('secondary', 'sm')}
                    aria-label={t('teamRoster.editContact')}
                    onClick={() => {
                      setEditing(member);
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden trigger={parentIconTrigger} size={16} />
                  </button>
                  <button
                    type="button"
                    className={buttonClassName('danger', 'sm')}
                    aria-label={t('teamRoster.deleteContact')}
                    onClick={() => {
                      void handleDelete(member);
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden trigger={parentIconTrigger} size={16} />
                  </button>
                </div>
              </div>
              <TeamProtocolBadges links={member.links} />
              {member.links.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {member.links.map((link) => (
                    <li key={link.protocol}>
                      <button
                        type="button"
                        className={buttonClassName('secondary', 'sm')}
                        aria-label={t('teamRoster.unlink', {
                          protocol: t(TEAM_PROTOCOL_LABEL_KEYS[link.protocol]),
                        })}
                        onClick={() => {
                          void handleUnlink(member.unitId, link.protocol);
                        }}
                      >
                        {t('teamRoster.unlink', {
                          protocol: t(TEAM_PROTOCOL_LABEL_KEYS[link.protocol]),
                        })}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editing !== undefined ? (
        <TeamContactEditorDialog
          member={editing}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      ) : null}
    </section>
  );
}
