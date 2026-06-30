/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';

export interface ReticulumIdentitySectionProps {
  embedded?: boolean;
}

export default function ReticulumIdentitySection({
  embedded = false,
}: ReticulumIdentitySectionProps) {
  const { t } = useTranslation();
  const [identities, setIdentities] = useState<{ id: string; label?: string }[]>([]);
  const [activeId, setActiveId] = useState<string>('default');
  const [announceInterval, setAnnounceInterval] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!(await isReticulumSidecarRunning())) return;
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/identities')) as {
        identities?: { id: string; label?: string }[];
        active_id?: string;
      };
      setIdentities(body.identities ?? [{ id: 'default' }]);
      if (body.active_id) setActiveId(body.active_id);
      const settings = (await window.electronAPI.reticulum.proxyGet('/api/v1/stack/settings')) as {
        announce_interval_sec?: number;
      };
      setAnnounceInterval(settings.announce_interval_sec ?? 0);
    } catch (e) {
      console.warn('[ReticulumIdentitySection] load ' + errLikeToLogString(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const switchIdentity = async (id: string) => {
    setBusy(true);
    try {
      await window.electronAPI.reticulum.proxyPost('/api/v1/identities/switch', {
        identity_id: id,
      });
      setActiveId(id);
    } catch (e) {
      console.warn('[ReticulumIdentitySection] switch ' + errLikeToLogString(e));
    } finally {
      setBusy(false);
    }
  };

  const saveAnnounceInterval = async () => {
    setBusy(true);
    try {
      const current = (await window.electronAPI.reticulum.proxyGet(
        '/api/v1/stack/settings',
      )) as Record<string, unknown>;
      await window.electronAPI.reticulum.proxyPut('/api/v1/stack/settings', {
        ...current,
        announce_interval_sec: announceInterval,
      });
    } catch (e) {
      console.warn('[ReticulumIdentitySection] announce interval ' + errLikeToLogString(e));
    } finally {
      setBusy(false);
    }
  };

  const clearAnnounces = async () => {
    setBusy(true);
    try {
      await window.electronAPI.reticulum.proxyDelete('/api/v1/announces');
    } catch (e) {
      console.warn('[ReticulumIdentitySection] clear announces ' + errLikeToLogString(e));
    } finally {
      setBusy(false);
    }
  };

  const content = (
    <>
      {!embedded ? (
        <h3 className="text-sm font-medium text-gray-200">{t('reticulumIdentity.title')}</h3>
      ) : null}
      <label className="mt-2 block text-xs text-gray-400" htmlFor="reticulum-identity-select">
        {t('reticulumIdentity.activeIdentity')}
      </label>
      <select
        id="reticulum-identity-select"
        value={activeId}
        disabled={busy}
        className="bg-deep-black mt-1 w-full rounded border border-gray-600 px-2 py-1 text-sm text-gray-200"
        onChange={(e) => {
          void switchIdentity(e.target.value);
        }}
      >
        {identities.map((id) => (
          <option key={id.id} value={id.id}>
            {id.label ?? id.id}
          </option>
        ))}
      </select>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-400" htmlFor="reticulum-announce-interval">
          {t('reticulumIdentity.announceIntervalSec')}
        </label>
        <input
          id="reticulum-announce-interval"
          type="number"
          min={0}
          max={86400}
          value={announceInterval}
          disabled={busy}
          className="bg-deep-black w-24 rounded border border-gray-600 px-2 py-1 text-sm text-gray-200"
          onChange={(e) => {
            setAnnounceInterval(Number(e.target.value) || 0);
          }}
        />
        <button
          type="button"
          disabled={busy}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200"
          onClick={() => {
            void saveAnnounceInterval();
          }}
        >
          {t('common.save')}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-amber-300"
          onClick={() => {
            void clearAnnounces();
          }}
        >
          {t('reticulumIdentity.clearAnnounces')}
        </button>
      </div>
    </>
  );

  if (embedded) return content;

  return <div className="bg-deep-black rounded-lg border border-gray-700 p-4">{content}</div>;
}
