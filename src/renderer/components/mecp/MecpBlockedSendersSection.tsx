import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { PROTOCOL_THEME } from '@/renderer/lib/protocolTheme';
import { mecpBlockKey, useMecpBlockStore } from '@/renderer/stores/mecpBlockStore';

/** App → MECP: senders whose MECP reports are audited only (no alert, incident, or rebroadcast). */
export function MecpBlockedSendersSection() {
  const { t } = useTranslation();
  const blocked = useMecpBlockStore((s) => s.blocked);
  const unblock = useMecpBlockStore((s) => s.unblock);
  const entries = useMemo(
    () => Object.values(blocked).sort((a, b) => b.createdAt - a.createdAt),
    [blocked],
  );

  return (
    <div className="space-y-2">
      <h4 className="text-ink-300 text-sm font-medium">{t('mecp.block.listTitle')}</h4>
      <p className="text-muted text-xs leading-relaxed">{t('mecp.block.listHint')}</p>
      {entries.length === 0 ? (
        <p className="text-muted text-xs italic">{t('mecp.block.listEmpty')}</p>
      ) : (
        <ul className="space-y-1" aria-label={t('mecp.block.listTitle')}>
          {entries.map((entry) => (
            <li
              key={mecpBlockKey(entry.protocol, entry.senderId)}
              className="border-ink-700/70 bg-ink-900/40 flex items-center justify-between gap-2 rounded border px-2 py-1"
            >
              <span className="text-ink-200 min-w-0 truncate text-xs">{entry.label}</span>
              <span className="text-muted shrink-0 font-mono text-xs">{entry.senderId}</span>
              <span className="text-muted shrink-0 text-xs">
                {PROTOCOL_THEME[entry.protocol].displayName}
              </span>
              <button
                type="button"
                aria-label={t('mecp.block.unblockAria', { sender: entry.label })}
                onClick={() => {
                  unblock(entry.protocol, entry.senderId);
                }}
                className="border-ink-600 text-ink-300 hover:bg-ink-700 ml-auto shrink-0 rounded border px-2 py-0.5 text-xs"
              >
                {t('mecp.block.unblock')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
