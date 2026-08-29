import { Gamepad2 } from 'lucide-react-motion';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { pushAppToast } from '@/renderer/components/Toast';
import { sendGamesChallenge } from '@/renderer/lib/reticulum/reticulumGamesSession';
import { RETICULUM_DM_HEADER_ACTION_CLASS } from '@/renderer/lib/reticulumDmHeaderActions';
import { GAMES_CHALLENGE_APPS, type GamesAppId } from '@/shared/games-types';

interface ReticulumGameChallengeButtonProps {
  lxmfPeerHash: string;
  disabled?: boolean;
  className?: string;
}

/** Compact "Challenge" control for Peers rows / Chat DM header — opens an LRGP game. */
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
    if (disabled) return;
    setMenuOpen(false);
    const ok = await sendGamesChallenge(lxmfPeerHash, appId);
    if (ok) {
      pushAppToast(
        t('gamesPanel.challengeSent', {
          app: t(`gamesPanel.apps.${appId}`, { defaultValue: appId }),
        }),
        'success',
      );
    }
  }

  const showMenu = menuOpen && !disabled;

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
          if (disabled) return;
          setMenuOpen((v) => !v);
        }}
      >
        <Gamepad2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t('gamesPanel.challenge')}</span>
      </button>
      {showMenu && (
        <div className="bg-deep-black absolute top-full right-0 z-10 mt-1 w-36 rounded border border-gray-600 shadow-lg">
          {GAMES_CHALLENGE_APPS.map((appId) => (
            <button
              key={appId}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-xs text-gray-100 hover:bg-gray-800 disabled:opacity-50"
              disabled={disabled}
              aria-label={t('gamesPanel.challengeAppAria', {
                app: t(`gamesPanel.apps.${appId}`, { defaultValue: appId }),
              })}
              onClick={(e) => {
                e.stopPropagation();
                void handleChallenge(appId);
              }}
            >
              {t(`gamesPanel.apps.${appId}`, { defaultValue: appId })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
