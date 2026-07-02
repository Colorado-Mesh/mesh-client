/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  listReticulumIdentities,
  type ReticulumSidecarIdentityRow,
  switchReticulumIdentity,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';

export interface ReticulumIdentitySwitcherProps {
  disabled?: boolean;
  onSwitched?: () => void;
}

export function ReticulumIdentitySwitcher({
  disabled = false,
  onSwitched,
}: ReticulumIdentitySwitcherProps) {
  const { t } = useTranslation();
  const [identities, setIdentities] = useState<ReticulumSidecarIdentityRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIdentities(await listReticulumIdentities());
    } catch (e) {
      console.warn('[ReticulumIdentitySwitcher] list ' + errLikeToLogString(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = identities.find((i) => i.active) ?? identities[0];

  const handleSwitch = async (id: string) => {
    if (id === active?.id) return;
    setBusy(true);
    setError(null);
    try {
      await switchReticulumIdentity(id);
      await refresh();
      onSwitched?.();
    } catch (e) {
      // catch-no-log-ok surfaced inline via setError
      setError(errLikeToLogString(e));
    } finally {
      setBusy(false);
    }
  };

  if (identities.length <= 1) {
    if (!active) return null;
    return (
      <p className="text-xs text-gray-400">
        {t('reticulumIdentitySwitcher.active', {
          name: active.display_name ?? active.id,
        })}
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <label className="text-xs text-gray-400" htmlFor="reticulum-identity-switch">
        {t('reticulumIdentitySwitcher.label')}
      </label>
      <select
        id="reticulum-identity-switch"
        disabled={disabled || busy}
        value={active?.id ?? ''}
        onChange={(e) => {
          void handleSwitch(e.target.value);
        }}
        className="w-full rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm text-gray-200"
        aria-label={t('reticulumIdentitySwitcher.label')}
      >
        {identities.map((row) => (
          <option key={row.id} value={row.id}>
            {row.display_name ?? row.id}
            {row.active ? ` (${t('reticulumIdentitySwitcher.activeBadge')})` : ''}
          </option>
        ))}
      </select>
      {error ? (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
