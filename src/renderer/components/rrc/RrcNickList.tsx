import { RefreshCw, X } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import { rrcNickColorClass } from '@/renderer/lib/rrcNickColor';
import type { RrcRoomMember } from '@/shared/rrc-types';

import { IconButton } from '../ui/Button';

function formatHash(hash: string): string {
  if (hash.startsWith('nick:')) return hash.slice(5);
  return hash.slice(0, 8);
}

/** Members of the open room; RrcPanel places it as a docked panel or a sheet (ConversationLayout). */
export interface RrcNickListProps {
  members: RrcRoomMember[];
  busy: boolean;
  onRefreshWho: () => void;
  onNickClick: (member: RrcRoomMember) => void;
  onClose: () => void;
}

export function RrcNickList({
  members,
  busy,
  onRefreshWho,
  onNickClick,
  onClose,
}: RrcNickListProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex min-h-14 shrink-0 items-center gap-1 border-b border-slate-800 pr-2 pl-3">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-200">
          {t('rrc.members')}{' '}
          <span className="text-muted font-mono text-xs font-normal">{members.length}</span>
        </h3>
        <IconButton
          size="sm"
          aria-label={t('rrc.refreshWho')}
          disabled={busy}
          onClick={onRefreshWho}
          icon={<RefreshCw aria-hidden className="h-3.5 w-3.5" size={14} />}
        />
        <IconButton
          size="sm"
          aria-label={t('rrc.hideMembers')}
          onClick={onClose}
          icon={<X aria-hidden className="h-4 w-4" size={16} />}
        />
      </div>
      <ul className="text-body min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {members.map((m) => {
          const label = m.nickname || formatHash(m.identity_hash);
          return (
            <li key={m.identity_hash}>
              <button
                type="button"
                className={`hover:bg-sidebar-active-bg/60 w-full truncate rounded-lg px-2 py-1.5 text-left ${rrcNickColorClass(label)}`}
                aria-label={t('rrc.msgNick', { name: label })}
                title={t('rrc.msgNick', { name: label })}
                onClick={() => {
                  onNickClick(m);
                }}
              >
                {label}
              </button>
            </li>
          );
        })}
        {members.length === 0 && <li className="text-muted px-2 text-xs">{t('rrc.noMembers')}</li>}
      </ul>
    </>
  );
}
