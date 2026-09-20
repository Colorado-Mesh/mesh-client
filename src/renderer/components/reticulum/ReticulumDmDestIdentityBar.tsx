import { Copy, X } from 'lucide-react-motion';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { ResolveReticulumStaleChatDestResult } from '@/renderer/lib/reticulum/resolveReticulumStaleChatDest';
import { RETICULUM_DM_HEADER_STATUS_CLASS } from '@/renderer/lib/reticulumDmHeaderActions';
import { writeClipboardText } from '@/renderer/lib/writeClipboardText';

function shortHashPrefix(hash: string): string {
  return hash
    .replace(/[^0-9a-f]/gi, '')
    .toLowerCase()
    .slice(0, 8);
}

export interface ReticulumDmDestIdentityBarProps {
  lxmfHash: string;
  identityHash: string | null;
  staleHint: ResolveReticulumStaleChatDestResult;
}

/**
 * DM header: copyable LXMF (+ identity) prefixes and optional stale-alternate banner.
 */
export function ReticulumDmDestIdentityBar({
  lxmfHash,
  identityHash,
  staleHint,
}: ReticulumDmDestIdentityBarProps) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState<'lxmf' | 'identity' | null>(null);

  const copyHash = useCallback(async (kind: 'lxmf' | 'identity', value: string) => {
    try {
      await writeClipboardText(value);
      setCopied(kind);
      window.setTimeout(() => {
        setCopied((prev) => (prev === kind ? null : prev));
      }, 1500);
    } catch (e: unknown) {
      console.warn('[ReticulumDmDestIdentityBar] copy ' + errLikeToLogString(e));
    }
  }, []);

  const lxmfPrefix = shortHashPrefix(lxmfHash);
  const identityPrefix = identityHash ? shortHashPrefix(identityHash) : null;
  const showBanner = !dismissed && staleHint.status === 'stale_alternate';
  const alternatePrefix =
    staleHint.status === 'stale_alternate' ? shortHashPrefix(staleHint.alternateHash) : null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div
        className={`${RETICULUM_DM_HEADER_STATUS_CLASS} flex min-w-0 flex-wrap items-center gap-1.5 text-gray-400`}
        role="status"
        aria-label={t('chatPanel.reticulumDmDestHashesAria')}
      >
        <button
          type="button"
          className="hover:text-readable-green inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[11px] text-gray-300 hover:bg-slate-700/60"
          aria-label={t('chatPanel.reticulumDmCopyLxmfAria', { prefix: lxmfPrefix })}
          title={lxmfHash}
          onClick={() => {
            void copyHash('lxmf', lxmfHash);
          }}
        >
          <span>{t('chatPanel.reticulumDmLxmfPrefix', { prefix: lxmfPrefix })}</span>
          <Copy className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
          {copied === 'lxmf' ? (
            <span className="text-readable-green text-[10px]">{t('common.copied')}</span>
          ) : null}
        </button>
        {identityHash && identityPrefix ? (
          <button
            type="button"
            className="hover:text-readable-green inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[11px] text-gray-300 hover:bg-slate-700/60"
            aria-label={t('chatPanel.reticulumDmCopyIdentityAria', { prefix: identityPrefix })}
            title={identityHash}
            onClick={() => {
              void copyHash('identity', identityHash);
            }}
          >
            <span>{t('chatPanel.reticulumDmIdentityPrefix', { prefix: identityPrefix })}</span>
            <Copy className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
            {copied === 'identity' ? (
              <span className="text-readable-green text-[10px]">{t('common.copied')}</span>
            ) : null}
          </button>
        ) : null}
      </div>
      {showBanner && alternatePrefix && staleHint.status === 'stale_alternate' ? (
        <div
          className="flex min-w-0 items-start gap-2 rounded-lg border border-amber-600/40 bg-amber-950/40 px-2.5 py-1.5 text-[11px] text-amber-100"
          role="status"
          aria-label={t('chatPanel.reticulumDmStaleAlternateAria')}
        >
          <p className="min-w-0 flex-1 leading-snug">
            {staleHint.alternateDisplayName
              ? t('chatPanel.reticulumDmStaleAlternateNamed', {
                  openPrefix: lxmfPrefix,
                  alternatePrefix,
                  name: staleHint.alternateDisplayName,
                })
              : t('chatPanel.reticulumDmStaleAlternate', {
                  openPrefix: lxmfPrefix,
                  alternatePrefix,
                })}
          </p>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-amber-200/80 hover:bg-amber-900/50 hover:text-amber-50"
            aria-label={t('chatPanel.reticulumDmStaleAlternateDismissAria')}
            onClick={() => {
              setDismissed(true);
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
