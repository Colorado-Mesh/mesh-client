import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';
import { type PnHostingPolicy } from '@/shared/pnHostingPolicy';

import { useToast } from './Toast';

interface ReticulumPnHostingDangerZoneProps {
  disabled?: boolean;
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  onChange,
  disabled,
}: Readonly<{
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}>) {
  return (
    <label htmlFor={id} className="text-xs text-yellow-200/90">
      {label}
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(Number(e.target.value));
        }}
        className="mt-1 block w-full max-w-[10rem] rounded border border-yellow-700/60 bg-slate-950/60 px-2 py-1 text-sm text-yellow-100"
        aria-label={label}
      />
    </label>
  );
}

/**
 * Yellow advanced danger zone for LXMF PN hosting / peering policy.
 * Collapsed by default; lives on Network after Propagation.
 */
export default function ReticulumPnHostingDangerZone({
  disabled = false,
}: Readonly<ReticulumPnHostingDangerZoneProps>) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const hostingPolicy = useReticulumPropagationStore((s) => s.hostingPolicy);
  const setHostingPolicyOnSidecar = useReticulumPropagationStore(
    (s) => s.setHostingPolicyOnSidecar,
  );
  const refreshFromSidecar = useReticulumPropagationStore((s) => s.refreshFromSidecar);

  const [draft, setDraft] = useState<PnHostingPolicy>(hostingPolicy);
  const [policySnapshot, setPolicySnapshot] = useState(hostingPolicy);
  const [saving, setSaving] = useState(false);

  if (hostingPolicy !== policySnapshot) {
    setPolicySnapshot(hostingPolicy);
    setDraft(hostingPolicy);
  }

  useEffect(() => {
    void refreshFromSidecar();
  }, [refreshFromSidecar]);

  const patch = <K extends keyof PnHostingPolicy>(key: K, value: PnHostingPolicy[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <details className="rounded-lg border border-yellow-700 bg-yellow-900/30 px-3 py-2 text-yellow-300">
      <summary className="cursor-pointer text-sm font-medium text-yellow-200">
        {t('networkPanel.reticulumPnHosting.title')}
      </summary>
      <p className="mt-2 text-xs text-yellow-200/80">
        {t('networkPanel.reticulumPnHosting.warning')}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <NumberField
          id="pn-peering-cost"
          label={t('networkPanel.reticulumPnHosting.peeringCost')}
          value={draft.peering_cost}
          min={0}
          max={255}
          disabled={disabled || saving}
          onChange={(n) => {
            patch('peering_cost', n);
          }}
        />
        <NumberField
          id="pn-max-peering-cost"
          label={t('networkPanel.reticulumPnHosting.maxPeeringCost')}
          value={draft.max_peering_cost}
          min={0}
          max={255}
          disabled={disabled || saving}
          onChange={(n) => {
            patch('max_peering_cost', n);
          }}
        />
        <NumberField
          id="pn-autopeer-maxdepth"
          label={t('networkPanel.reticulumPnHosting.autopeerMaxdepth')}
          value={draft.autopeer_maxdepth}
          min={0}
          max={64}
          disabled={disabled || saving}
          onChange={(n) => {
            patch('autopeer_maxdepth', n);
          }}
        />
        <NumberField
          id="pn-max-peers"
          label={t('networkPanel.reticulumPnHosting.maxPeers')}
          value={draft.max_peers}
          min={1}
          max={256}
          disabled={disabled || saving}
          onChange={(n) => {
            patch('max_peers', n);
          }}
        />
        <NumberField
          id="pn-stamp-cost"
          label={t('networkPanel.reticulumPnHosting.stampCost')}
          value={draft.propagation_stamp_cost}
          min={0}
          max={255}
          disabled={disabled || saving}
          onChange={(n) => {
            patch('propagation_stamp_cost', n);
          }}
        />
        <NumberField
          id="pn-stamp-flex"
          label={t('networkPanel.reticulumPnHosting.stampFlex')}
          value={draft.propagation_stamp_flex}
          min={0}
          max={255}
          disabled={disabled || saving}
          onChange={(n) => {
            patch('propagation_stamp_flex', n);
          }}
        />
        <NumberField
          id="pn-storage-mb"
          label={t('networkPanel.reticulumPnHosting.storageMb')}
          value={draft.message_storage_limit_mb}
          min={1}
          max={10_240}
          disabled={disabled || saving}
          onChange={(n) => {
            patch('message_storage_limit_mb', n);
          }}
        />
        <NumberField
          id="pn-prop-limit"
          label={t('networkPanel.reticulumPnHosting.propagationLimitKb')}
          value={draft.propagation_limit_kb}
          min={1}
          max={102_400}
          disabled={disabled || saving}
          onChange={(n) => {
            patch('propagation_limit_kb', n);
          }}
        />
        <NumberField
          id="pn-sync-limit"
          label={t('networkPanel.reticulumPnHosting.syncLimitKb')}
          value={draft.sync_limit_kb}
          min={1}
          max={102_400}
          disabled={disabled || saving}
          onChange={(n) => {
            patch('sync_limit_kb', n);
          }}
        />
        <NumberField
          id="pn-delivery-limit"
          label={t('networkPanel.reticulumPnHosting.deliveryLimitKb')}
          value={draft.delivery_limit_kb}
          min={1}
          max={102_400}
          disabled={disabled || saving}
          onChange={(n) => {
            patch('delivery_limit_kb', n);
          }}
        />
        <NumberField
          id="pn-announce-interval"
          label={t('networkPanel.reticulumPnHosting.announceIntervalSec')}
          value={draft.pn_announce_interval_sec}
          min={0}
          max={86_400}
          disabled={disabled || saving}
          onChange={(n) => {
            patch('pn_announce_interval_sec', n);
          }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-yellow-100">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.autopeer}
            disabled={disabled || saving}
            onChange={(e) => {
              patch('autopeer', e.target.checked);
            }}
            aria-label={t('networkPanel.reticulumPnHosting.autopeer')}
          />
          {t('networkPanel.reticulumPnHosting.autopeer')}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.announce_at_start}
            disabled={disabled || saving}
            onChange={(e) => {
              patch('announce_at_start', e.target.checked);
            }}
            aria-label={t('networkPanel.reticulumPnHosting.announceAtStart')}
          />
          {t('networkPanel.reticulumPnHosting.announceAtStart')}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.from_static_only}
            disabled={disabled || saving}
            onChange={(e) => {
              patch('from_static_only', e.target.checked);
            }}
            aria-label={t('networkPanel.reticulumPnHosting.fromStaticOnly')}
          />
          {t('networkPanel.reticulumPnHosting.fromStaticOnly')}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.auth_required}
            disabled={disabled || saving}
            onChange={(e) => {
              patch('auth_required', e.target.checked);
            }}
            aria-label={t('networkPanel.reticulumPnHosting.authRequired')}
          />
          {t('networkPanel.reticulumPnHosting.authRequired')}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.enforce_stamps}
            disabled={disabled || saving}
            onChange={(e) => {
              patch('enforce_stamps', e.target.checked);
            }}
            aria-label={t('networkPanel.reticulumPnHosting.enforceStamps')}
          />
          {t('networkPanel.reticulumPnHosting.enforceStamps')}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.enforce_ratchets}
            disabled={disabled || saving}
            onChange={(e) => {
              patch('enforce_ratchets', e.target.checked);
            }}
            aria-label={t('networkPanel.reticulumPnHosting.enforceRatchets')}
          />
          {t('networkPanel.reticulumPnHosting.enforceRatchets')}
        </label>
      </div>
      <label htmlFor="pn-node-name" className="mt-3 block text-xs text-yellow-200/90">
        {t('networkPanel.reticulumPnHosting.nodeName')}
        <input
          id="pn-node-name"
          type="text"
          value={draft.node_name ?? ''}
          disabled={disabled || saving}
          onChange={(e) => {
            patch('node_name', e.target.value.trim() ? e.target.value : null);
          }}
          className="mt-1 block w-full max-w-md rounded border border-yellow-700/60 bg-slate-950/60 px-2 py-1 text-sm text-yellow-100"
          aria-label={t('networkPanel.reticulumPnHosting.nodeName')}
        />
      </label>
      <label htmlFor="pn-static-peers" className="mt-3 block text-xs text-yellow-200/90">
        {t('networkPanel.reticulumPnHosting.staticPeers')}
        <textarea
          id="pn-static-peers"
          rows={3}
          value={draft.static_peers.join('\n')}
          disabled={disabled || saving}
          onChange={(e) => {
            patch(
              'static_peers',
              e.target.value
                .split(/\r?\n/)
                .map((l) => l.trim().toLowerCase())
                .filter(Boolean),
            );
          }}
          className="mt-1 block w-full max-w-xl rounded border border-yellow-700/60 bg-slate-950/60 px-2 py-1 font-mono text-xs text-yellow-100"
          aria-label={t('networkPanel.reticulumPnHosting.staticPeers')}
          placeholder={t('networkPanel.reticulumPnHosting.staticPeersPlaceholder')}
        />
      </label>
      <button
        type="button"
        disabled={disabled || saving}
        className="mt-3 rounded border border-yellow-600 bg-yellow-900/50 px-3 py-1.5 text-sm text-yellow-100 hover:bg-yellow-800/50 disabled:opacity-40"
        aria-label={t('networkPanel.reticulumPnHosting.saveAria')}
        onClick={() => {
          setSaving(true);
          void setHostingPolicyOnSidecar(draft).then((ok) => {
            setSaving(false);
            if (ok) {
              addToast(t('networkPanel.reticulumPnHosting.saveOk'), 'success');
            } else {
              addToast(t('networkPanel.reticulumPnHosting.saveFailed'), 'error');
            }
          });
        }}
      >
        {saving
          ? t('networkPanel.reticulumPnHosting.saving')
          : t('networkPanel.reticulumPnHosting.save')}
      </button>
    </details>
  );
}
