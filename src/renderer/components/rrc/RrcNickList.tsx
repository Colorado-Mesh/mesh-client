import { RefreshCw } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import type { RrcRoomMember } from '@/shared/rrc-types';

function formatHash(hash: string): string {
  if (hash.startsWith('nick:')) return hash.slice(5);
  return hash.slice(0, 8);
}

export interface RrcNickListProps {
  members: RrcRoomMember[];
  busy: boolean;
  onRefreshWho: () => void;
  onNickClick: (member: RrcRoomMember) => void;
}

export function RrcNickList({ members, busy, onRefreshWho, onNickClick }: RrcNickListProps) {
  const { t } = useTranslation();
  return (
    <aside className="bg-secondary-dark/60 flex w-44 shrink-0 flex-col overflow-hidden border-l border-amber-800/40">
      <div className="flex items-center justify-between border-b border-amber-800/40 px-2 py-1.5">
        <span className="text-xs font-semibold tracking-wide text-amber-400/80 uppercase">
          {t('rrc.members')}
        </span>
        <button
          type="button"
          className="rounded p-1 text-amber-200/70 hover:bg-amber-950/50"
          aria-label={t('rrc.refreshWho')}
          disabled={busy}
          onClick={onRefreshWho}
        >
          <RefreshCw size={12} />
        </button>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2 text-xs">
        {members.map((m) => {
          const label = m.nickname || formatHash(m.identity_hash);
          return (
            <li key={m.identity_hash}>
              <button
                type="button"
                className="w-full truncate rounded px-1.5 py-1 text-left text-amber-100/90 hover:bg-amber-950/40"
                aria-label={t('rrc.msgNick', { name: label })}
                onClick={() => {
                  onNickClick(m);
                }}
              >
                {label}
              </button>
            </li>
          );
        })}
        {members.length === 0 && <li className="text-amber-200/40">{t('rrc.noMembers')}</li>}
      </ul>
    </aside>
  );
}
