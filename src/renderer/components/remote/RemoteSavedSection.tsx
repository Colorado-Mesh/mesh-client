import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/renderer/components/Toast';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useReticulumRemoteAddressStore } from '@/renderer/stores/reticulumRemoteAddressStore';
import type { RemoteAddressService } from '@/shared/remote-types';

/** Reticulum Remote → Saved: manage the rnsh/rncp address book (`reticulum_remote_addresses`). */
export function RemoteSavedSection() {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const addresses = useReticulumRemoteAddressStore((s) => s.addresses);
  const upsert = useReticulumRemoteAddressStore((s) => s.upsert);
  const remove = useReticulumRemoteAddressStore((s) => s.remove);

  const [label, setLabel] = useState('');
  const [hash, setHash] = useState('');
  const [service, setService] = useState<RemoteAddressService>('rnsh');
  const [editingId, setEditingId] = useState<string | null>(null);

  const list = useMemo(
    () => [...addresses.values()].sort((a, b) => b.updated_at - a.updated_at),
    [addresses],
  );

  const resetForm = () => {
    setLabel('');
    setHash('');
    setService('rnsh');
    setEditingId(null);
  };

  const handleSave = async () => {
    const clean = hash
      .trim()
      .toLowerCase()
      .replace(/[^0-9a-f]/g, '');
    if (clean.length !== 32) {
      addToast(t('reticulumRemote.errors.invalidAddress'), 'error');
      return;
    }
    if (!label.trim()) {
      addToast(t('reticulumRemote.saved.labelRequired'), 'error');
      return;
    }
    try {
      await upsert({
        id: editingId ?? undefined,
        label: label.trim(),
        service,
        destination_hash: clean,
      });
      resetForm();
    } catch (e) {
      console.debug('[RemoteSavedSection] save ' + errLikeToLogString(e));
      addToast(t('reticulumRemote.saved.saveFailed', { error: errLikeToLogString(e) }), 'error');
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-700/60 p-3">
        <input
          type="text"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
          }}
          placeholder={t('reticulumRemote.saved.labelPlaceholder')}
          aria-label={t('reticulumRemote.saved.labelAria')}
          className="bg-secondary-dark/80 min-w-[140px] flex-1 rounded-lg border border-gray-600/50 px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500/50 focus:outline-none"
        />
        <input
          type="text"
          value={hash}
          onChange={(e) => {
            setHash(e.target.value);
          }}
          placeholder={t('reticulumRemote.saved.hashPlaceholder')}
          aria-label={t('reticulumRemote.saved.hashAria')}
          className="bg-secondary-dark/80 min-w-[220px] flex-1 rounded-lg border border-gray-600/50 px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500/50 focus:outline-none"
        />
        <select
          value={service}
          onChange={(e) => {
            setService(e.target.value as RemoteAddressService);
          }}
          aria-label={t('reticulumRemote.saved.serviceAria')}
          className="bg-secondary-dark/80 rounded-lg border border-gray-600/50 px-2 py-1.5 text-sm text-gray-200"
        >
          <option value="rnsh">{t('reticulumRemote.saved.serviceRnsh')}</option>
          <option value="rncp">{t('reticulumRemote.saved.serviceRncp')}</option>
        </select>
        <button
          type="button"
          aria-label={t('reticulumRemote.saved.saveAria')}
          onClick={() => void handleSave()}
          className="rounded bg-blue-700/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600"
        >
          {editingId ? t('common.save') : t('reticulumRemote.saved.add')}
        </button>
        {editingId && (
          <button
            type="button"
            aria-label={t('common.cancel')}
            onClick={resetForm}
            className="rounded bg-gray-700/60 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-600"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {list.length === 0 ? (
          <p className="text-muted text-xs">{t('reticulumRemote.saved.empty')}</p>
        ) : (
          list.map((addr) => (
            <div
              key={addr.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-700/60 bg-gray-800/30 px-3 py-2 text-xs text-gray-200"
            >
              <span className="rounded bg-gray-700/60 px-1.5 py-0.5 text-[10px] text-gray-300 uppercase">
                {addr.service}
              </span>
              <span className="font-medium">{addr.label}</span>
              <code className="text-muted min-w-0 flex-1 truncate">{addr.destination_hash}</code>
              <button
                type="button"
                aria-label={t('reticulumRemote.saved.editAria', { label: addr.label })}
                onClick={() => {
                  setEditingId(addr.id);
                  setLabel(addr.label);
                  setHash(addr.destination_hash);
                  setService(addr.service);
                }}
                className="rounded bg-gray-700/60 px-2 py-1 text-gray-200 hover:bg-gray-600"
              >
                {t('common.edit')}
              </button>
              <button
                type="button"
                aria-label={t('reticulumRemote.saved.deleteAria', { label: addr.label })}
                onClick={() => void remove(addr.id)}
                className="rounded bg-red-900/50 px-2 py-1 text-red-300 hover:bg-red-900/70"
              >
                {t('common.delete')}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
