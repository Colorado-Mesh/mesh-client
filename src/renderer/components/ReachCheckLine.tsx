import { type ReactElement, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { reachCheckKey, useReachCheckStore } from '@/renderer/lib/reachCheck/reachCheckStore';
import type { IdentityId } from '@/renderer/lib/types';

export interface ReachCheckLineProps {
  messageId: string | undefined;
  isOwn: boolean;
  identityId: IdentityId | null | undefined;
  /** The radio did not send the code (bubble failed): no line, and polling stops. */
  failed?: boolean;
}

/**
 * Reach check results under the sent code's bubble: observers that heard it, repeaters, farthest
 * distance, and a link to the server's full results page. In memory only (see reachCheckStore).
 */
export function ReachCheckLine({
  messageId,
  isOwn,
  identityId,
  failed = false,
}: ReachCheckLineProps): ReactElement | null {
  const { t } = useTranslation();
  const key = identityId && messageId ? reachCheckKey(identityId, messageId) : null;
  const entry = useReachCheckStore((s) => (key ? s.entries[key] : undefined));
  const hasEntry = entry != null;
  useEffect(() => {
    // The poller finds no entry on its next tick and stops.
    if (failed && hasEntry && key) useReachCheckStore.getState().remove(key);
  }, [failed, hasEntry, key]);
  if (!isOwn || !entry || failed) return null;

  const session = entry.session;
  let text: string;
  let tone = 'text-green-400';
  if (entry.state === 'gone') {
    text = t('reachCheck.lineGone');
    tone = 'text-orange-400';
  } else if (entry.state === 'error') {
    text = t('reachCheck.lineUnreachable');
    tone = 'text-orange-400';
  } else if (!session || session.observedCount === 0) {
    text =
      entry.state === 'finished' ? t('reachCheck.lineFinishedNone') : t('reachCheck.lineWaiting');
    tone = entry.state === 'finished' ? 'text-orange-400' : 'text-muted';
  } else {
    const parts = [
      t('reachCheck.lineObservers', { seen: session.observedCount, count: session.expectedCount }),
    ];
    if (session.repeaterCount > 0) {
      parts.push(t('reachCheck.lineRepeaters', { count: session.repeaterCount }));
    }
    if (session.distanceText) {
      parts.push(t('reachCheck.lineFarthest', { distance: session.distanceText }));
    }
    const summary = parts.join(', ');
    text =
      entry.state === 'finished'
        ? t('reachCheck.lineFinished', { summary })
        : t('reachCheck.lineResults', { summary });
  }

  const sharePath = session?.sharePath;
  return (
    <div className="mt-0.5 flex flex-wrap items-center justify-end gap-x-2 text-xs">
      <span role="status" className={tone}>
        {text}
      </span>
      {entry.state !== 'gone' && sharePath ? (
        <a
          href={`${entry.origin}${sharePath}`}
          target="_blank"
          rel="noreferrer"
          className="text-muted hover:text-brand-green underline-offset-2 transition-colors hover:underline"
        >
          {t('reachCheck.lineFullResults')}
        </a>
      ) : null}
    </div>
  );
}
