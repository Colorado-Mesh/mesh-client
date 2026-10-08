import { type SyntheticEvent, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { INPUT_BOX_SM_CLASS, SELECT_BOX_SM_CLASS } from './ui/formClasses';

interface Props {
  disabled?: boolean;
  onApply: (pubkeyHex: string, level: number) => Promise<void> | Promise<boolean>;
}

/** Room ACL setperm form — used on Repeaters & Rooms ops CLI row. */
export function MeshcoreRoomAclControls({ disabled, onApply }: Props) {
  const { t } = useTranslation();
  const [aclPubkey, setAclPubkey] = useState('');
  // Default guest (read-only) — matches historical Rooms ACL form; avoid silent RW bump.
  const [aclLevel, setAclLevel] = useState(1);
  const [pending, setPending] = useState(false);

  const handleSubmit = useCallback(
    async (e: SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      const normalized = aclPubkey.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalized)) return;
      setPending(true);
      try {
        const applied = await onApply(normalized, aclLevel);
        if (applied !== false) setAclPubkey('');
      } finally {
        setPending(false);
      }
    },
    [aclLevel, aclPubkey, onApply],
  );

  return (
    <form className="mb-2 flex flex-wrap items-end gap-2" onSubmit={(e) => void handleSubmit(e)}>
      <label className="min-w-[12rem] flex-1 space-y-1">
        <span className="text-ink-400 text-xs">{t('roomsPanel.aclPubkeyLabel')}</span>
        <input
          type="text"
          value={aclPubkey}
          onChange={(e) => {
            setAclPubkey(e.target.value);
          }}
          placeholder={t('roomsPanel.aclPubkeyPlaceholder')}
          disabled={disabled || pending}
          className={`${INPUT_BOX_SM_CLASS} w-full font-mono`}
          aria-label={t('roomsPanel.aclPubkeyLabel')}
        />
      </label>
      <label className="space-y-1">
        <span className="text-ink-400 text-xs">{t('roomsPanel.aclLevelLabel')}</span>
        <select
          value={aclLevel}
          onChange={(e) => {
            setAclLevel(Number.parseInt(e.target.value, 10));
          }}
          disabled={disabled || pending}
          className={SELECT_BOX_SM_CLASS}
          aria-label={t('roomsPanel.aclLevelLabel')}
        >
          <option value={0}>{t('roomsPanel.aclLevelRemove')}</option>
          <option value={1}>{t('roomsPanel.aclLevelGuest')}</option>
          <option value={2}>{t('roomsPanel.aclLevelReadWrite')}</option>
          <option value={3}>{t('roomsPanel.aclLevelAdmin')}</option>
        </select>
      </label>
      <button
        type="submit"
        disabled={disabled || pending || !/^[0-9a-f]{64}$/i.test(aclPubkey.trim())}
        className="border-ink-600 bg-ink-700 text-ink-200 rounded border px-3 py-1 text-xs disabled:opacity-40"
      >
        {t('roomsPanel.aclApply')}
      </button>
    </form>
  );
}
