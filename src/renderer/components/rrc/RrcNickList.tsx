import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import type { RrcRoomMember } from '@/shared/rrc-types';

function formatHash(hash: string): string {
  if (hash.startsWith('nick:')) return hash.slice(5);
  return hash.slice(0, 8);
}

export interface RrcNickListProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  members: RrcRoomMember[];
  busy: boolean;
  onRefreshWho: () => void;
  onNickClick: (member: RrcRoomMember) => void;
}

export function RrcNickList({
  collapsed,
  onToggleCollapsed,
  members,
  busy,
  onRefreshWho,
  onNickClick,
}: RrcNickListProps) {
  const { t } = useTranslation();
  return (
    <aside
      className={`bg-secondary-dark/60 flex shrink-0 flex-col overflow-hidden border-l border-amber-800/40 ${
        collapsed ? 'w-16' : 'w-44'
      }`}
    >
      <div
        className={`flex items-center gap-1 border-b border-amber-800/40 px-2 py-1.5 ${
          collapsed ? 'justify-center' : 'justify-between'
        }`}
      >
        {!collapsed && (
          <span className="min-w-0 flex-1 truncate text-xs font-semibold tracking-wide text-amber-400/80 uppercase">
            {t('rrc.members')}
          </span>
        )}
        <div className="flex items-center gap-0.5">
          {!collapsed && (
            <button
              type="button"
              className="rounded p-1 text-amber-200/70 hover:bg-amber-950/50"
              aria-label={t('rrc.refreshWho')}
              title={t('rrc.refreshWho')}
              disabled={busy}
              onClick={onRefreshWho}
            >
              <RefreshCw size={12} />
            </button>
          )}
          <button
            type="button"
            className="rounded p-1 text-amber-200/80 hover:bg-amber-950/50"
            aria-label={collapsed ? t('rrc.expandMembers') : t('rrc.collapseMembers')}
            title={collapsed ? t('rrc.expandMembers') : t('rrc.collapseMembers')}
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
          >
            {/* Right-rail: chevron points toward the edge when expanded. */}
            {collapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
      </div>
      {collapsed ? (
        <div className="flex flex-1 flex-col items-center gap-2 py-2">
          <span
            className="text-[10px] font-semibold tracking-wide text-amber-400/70 uppercase"
            title={t('rrc.members')}
          >
            {members.length}
          </span>
          <button
            type="button"
            className="rounded p-1 text-amber-200/70 hover:bg-amber-950/50"
            aria-label={t('rrc.refreshWho')}
            title={t('rrc.refreshWho')}
            disabled={busy}
            onClick={onRefreshWho}
          >
            <RefreshCw size={12} />
          </button>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2 text-xs">
          {members.map((m) => {
            const label = m.nickname || formatHash(m.identity_hash);
            return (
              <li key={m.identity_hash}>
                <button
                  type="button"
                  className="w-full truncate rounded px-1.5 py-1 text-left text-amber-100/90 hover:bg-amber-950/40"
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
          {members.length === 0 && <li className="text-amber-200/40">{t('rrc.noMembers')}</li>}
        </ul>
      )}
    </aside>
  );
}
