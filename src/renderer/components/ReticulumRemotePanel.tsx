import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RemoteSavedSection } from '@/renderer/components/remote/RemoteSavedSection';
import { RemoteSettingsSection } from '@/renderer/components/remote/RemoteSettingsSection';
import { RemoteShellSection } from '@/renderer/components/remote/RemoteShellSection';
import { RemoteTransferSection } from '@/renderer/components/remote/RemoteTransferSection';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  loadRemoteSettings,
  type RemoteSettings,
  updateRemoteSettings,
} from '@/renderer/lib/remoteSettingsStorage';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { useReticulumInboundPolicyStore } from '@/renderer/stores/reticulumInboundPolicyStore';
import { useReticulumRemoteAddressStore } from '@/renderer/stores/reticulumRemoteAddressStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';

type RemoteSection = 'shell' | 'transfer' | 'saved' | 'settings';

const SECTIONS: RemoteSection[] = ['shell', 'transfer', 'saved', 'settings'];

export interface ReticulumRemotePanelProps {
  isActive: boolean;
}

/** Reticulum Remote tab: rnsh remote shell + rncp file transfer (Shell | Transfer | Saved | Settings). */
export default function ReticulumRemotePanel({ isActive }: ReticulumRemotePanelProps) {
  const { t } = useTranslation();

  const [section, setSection] = useState<RemoteSection>('shell');
  const [sidecarRunning, setSidecarRunning] = useState(false);
  const [settings, setSettings] = useState<RemoteSettings>(() => loadRemoteSettings());

  const hydrateAddresses = useReticulumRemoteAddressStore((s) => s.hydrate);
  const hydratePolicies = useReticulumInboundPolicyStore((s) => s.hydrate);
  const pendingOfferCount = useRncpTransferStore((s) => s.pendingOffers.size);

  useEffect(() => {
    void hydrateAddresses();
    void hydratePolicies();
  }, [hydrateAddresses, hydratePolicies]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const running = await isReticulumSidecarRunning();
        if (!cancelled) setSidecarRunning(running);
      } catch (e) {
        console.debug('[ReticulumRemotePanel] sidecar status ' + errLikeToLogString(e));
      }
    })();
    const unsub = window.electronAPI.reticulum.onStatus((s) => {
      setSidecarRunning(s.running);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const handleSettingsChange = (patch: Partial<RemoteSettings>) => {
    setSettings(updateRemoteSettings(patch));
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <nav
        className="flex flex-wrap gap-1 border-b border-gray-700/60 px-2 pt-2"
        aria-label={t('reticulumRemote.navAria')}
      >
        {SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={section === s}
            aria-label={t(`reticulumRemote.sections.${s}`)}
            onClick={() => {
              setSection(s);
            }}
            className={`relative rounded-t-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              section === s
                ? 'border border-b-0 border-gray-700/60 bg-gray-800/60 text-gray-100'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t(`reticulumRemote.sections.${s}`)}
            {s === 'transfer' && pendingOfferCount > 0 && (
              <span
                className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-semibold text-white"
                aria-label={t('reticulumRemote.transfer.pendingOffersBadgeAria', {
                  count: pendingOfferCount,
                })}
              >
                {pendingOfferCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      {!sidecarRunning && (
        <div className="border-b border-amber-700/50 bg-amber-900/20 px-3 py-1.5 text-xs text-amber-200">
          {t('reticulumRemote.sidecarNotRunning')}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {section === 'shell' && (
          <RemoteShellSection
            sidecarRunning={sidecarRunning}
            settings={settings}
            isActive={isActive}
          />
        )}
        {section === 'transfer' && (
          <RemoteTransferSection sidecarRunning={sidecarRunning} settings={settings} />
        )}
        {section === 'saved' && <RemoteSavedSection />}
        {section === 'settings' && (
          <RemoteSettingsSection
            sidecarRunning={sidecarRunning}
            settings={settings}
            onSettingsChange={handleSettingsChange}
          />
        )}
      </div>
    </div>
  );
}
