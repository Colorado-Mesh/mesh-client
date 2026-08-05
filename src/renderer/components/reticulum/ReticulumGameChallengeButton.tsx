import { Gamepad2 } from 'lucide-react-motion';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { pushAppToast } from '@/renderer/components/Toast';
import { sendGamesChallenge } from '@/renderer/lib/reticulum/reticulumGamesSession';
import { RETICULUM_DM_HEADER_ACTION_CLASS } from '@/renderer/lib/reticulumDmHeaderActions';
import type { GamesAppId } from '@/shared/games-types';

interface ReticulumGameChallengeButtonProps {
  lxmfPeerHash: string;
  disabled?: boolean;
  className?: string;
}

const CHALLENGE_APPS: GamesAppId[] = ['ttt', 'chess'];

/** Compact "Challenge" control for Peers rows / Chat DM header — opens LRGP ttt/chess. */
export function ReticulumGameChallengeButton({
  lxmfPeerHash,
  disabled = false,
  className = `${RETICULUM_DM_HEADER_ACTION_CLASS} ml-2`,
}: ReticulumGameChallengeButtonProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [menuOpen]);

  async function handleChallenge(appId: GamesAppId) {
    setMenuOpen(false);
    const ok = await sendGamesChallenge(lxmfPeerHash, appId);
    if (ok) {
      pushAppToast(
        t('gamesPanel.challengeSent', { app: t(`gamesPanel.apps.${appId}`) }),
        'success',
      );
    }
  }

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-label={t('gamesPanel.challengeAria')}
        title={t('gamesPanel.challengeAria')}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
      >
        <Gamepad2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t('gamesPanel.challenge')}</span>
      </button>
      {menuOpen && (
        <div className="absolute top-full right-0 z-10 mt-1 w-36 rounded border border-amber-800/60 bg-slate-900 shadow-lg">
          {CHALLENGE_APPS.map((appId) => (
            <button
              key={appId}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-xs text-amber-100 hover:bg-amber-900/60"
              aria-label={t('gamesPanel.challengeAppAria', { app: t(`gamesPanel.apps.${appId}`) })}
              onClick={(e) => {
                e.stopPropagation();
                void handleChallenge(appId);
              }}
            >
              {t(`gamesPanel.apps.${appId}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
