import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { LORA_BLOCKLIST_SCOPE_ID } from '@/renderer/lib/loraBlocklist';
import type { MeshNode } from '@/renderer/lib/types';
import { useBlockedEntries, useBlockStore } from '@/renderer/stores/blockStore';

import { useToast } from './Toast';

function labelForBlockedHash(hash: string, nodes: Map<number, MeshNode> | undefined): string {
  if (!/^\d+$/.test(hash)) return hash;
  const node = nodes?.get(Number(hash));
  return node?.long_name || node?.short_name || hash;
}

/** App tab list of fully blocked Meshtastic / MeshCore nodes (block from Node Detail). */
export function LoraBlockedNodesSection({
  protocol,
  nodes,
}: {
  protocol: 'meshtastic' | 'meshcore';
  nodes?: Map<number, MeshNode>;
}) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const entries = useBlockedEntries(protocol);
  const unblock = useBlockStore((s) => s.unblock);

  return (
    <div className="space-y-2">
      <h3 className="text-ink-300 text-sm font-medium">{t('appPanel.loraBlocklist.title')}</h3>
      <p className="text-muted text-xs leading-relaxed">
        {t('appPanel.loraBlocklist.description')}
      </p>
      {entries.length === 0 ? (
        <p className="text-muted text-xs italic">{t('appPanel.loraBlocklist.empty')}</p>
      ) : (
        <ul className="space-y-1" aria-label={t('appPanel.loraBlocklist.title')}>
          {entries.map((entry) => {
            const label = labelForBlockedHash(entry.hash, nodes);
            return (
              <li
                key={entry.hash}
                className="border-ink-700/70 bg-ink-900/40 flex items-center justify-between gap-2 rounded border px-2 py-1"
              >
                <span className="text-ink-300 min-w-0 truncate font-mono text-xs">{label}</span>
                <span className="text-muted shrink-0 text-xs">
                  {new Date(entry.createdAt).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  aria-label={t('appPanel.loraBlocklist.unblockAria', { node: label })}
                  onClick={() => {
                    void unblock(protocol, LORA_BLOCKLIST_SCOPE_ID, entry.hash).catch(
                      (err: unknown) => {
                        console.warn(
                          '[LoraBlockedNodesSection] unblock failed ' + errLikeToLogString(err),
                        );
                        addToast(t('appPanel.loraBlocklist.unblockFailed'), 'error');
                      },
                    );
                  }}
                  className="border-ink-600 text-ink-300 hover:bg-ink-700 shrink-0 rounded border px-2 py-0.5 text-xs"
                >
                  {t('nodeDetailModal.unblockContact')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
