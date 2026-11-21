import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isMeshcomGroupDest } from '../lib/meshcom/meshcomChannel';
import {
  compactMeshcomGrcDraftSlots,
  MESHCOM_GRC_MAX_SLOTS,
  padMeshcomGrcSlotTexts,
  searchMeshcomGrcGroups,
} from '../lib/meshcom/meshcomGrcGroups';
import { INPUT_BOX_CLASS } from './ui/formClasses';
import { Switch } from './ui/Switch';

export interface MeshComGrcEditorProps {
  /** Current listen slots (device snapshot or local draft). */
  slots: readonly number[];
  /** `--nomsgall` from device when known. */
  nomsgall?: 'on' | 'off' | null;
  disabled: boolean;
  busy?: boolean;
  /** Apply listen list to the node (`--setgrc`). Empty list clears. */
  onApplyListen: (ids: readonly number[]) => Promise<void>;
  /** Toggle `--nomsgall` when Serial/BLE is available. */
  onNomsgallChange?: (value: 'on' | 'off') => Promise<void>;
  /** Also open the group as a chat pill (local). */
  onOpenInChat?: (id: number) => void;
}

/**
 * Six-slot MeshCom GRC listen editor (master = first slot) plus optional `--nomsgall`.
 */
export default function MeshComGrcEditor({
  slots,
  nomsgall,
  disabled,
  busy = false,
  onApplyListen,
  onNomsgallChange,
  onOpenInChat,
}: MeshComGrcEditorProps) {
  const { t } = useTranslation();
  const slotsKey = slots.join(';');
  const [draftTexts, setDraftTexts] = useState<string[]>(() => padMeshcomGrcSlotTexts(slots));
  const [syncedSlotsKey, setSyncedSlotsKey] = useState(slotsKey);
  const [customId, setCustomId] = useState('');
  const [query, setQuery] = useState('');
  const [localBusy, setLocalBusy] = useState(false);
  const working = busy || localBusy;

  // Adjust draft when the device snapshot changes (React “store info from props” pattern).
  if (slotsKey !== syncedSlotsKey) {
    setSyncedSlotsKey(slotsKey);
    setDraftTexts(padMeshcomGrcSlotTexts(slots));
  }

  const searchHits = useMemo(() => searchMeshcomGrcGroups(query).slice(0, 24), [query]);
  const filledCount = draftTexts.filter((text) => text.trim().length > 0).length;
  const draftHasId = useCallback(
    (id: number) => draftTexts.some((text) => text.trim() === String(id)),
    [draftTexts],
  );

  const setSlot = useCallback((index: number, raw: string) => {
    setDraftTexts((prev) => {
      const next = [...prev];
      next[index] = raw;
      return next;
    });
  }, []);

  const addId = useCallback(
    (id: number) => {
      setDraftTexts((prev) => {
        if (prev.some((text) => text.trim() === String(id))) return prev;
        const empty = prev.findIndex((text) => !text.trim());
        if (empty < 0) return prev;
        const next = [...prev];
        next[empty] = String(id);
        return next;
      });
      onOpenInChat?.(id);
    },
    [onOpenInChat],
  );

  const apply = useCallback(async () => {
    setLocalBusy(true);
    try {
      await onApplyListen(compactMeshcomGrcDraftSlots(draftTexts));
    } finally {
      setLocalBusy(false);
    }
  }, [draftTexts, onApplyListen]);

  const clearAll = useCallback(async () => {
    setDraftTexts(padMeshcomGrcSlotTexts([]));
    setLocalBusy(true);
    try {
      await onApplyListen([]);
    } finally {
      setLocalBusy(false);
    }
  }, [onApplyListen]);

  return (
    <div className="space-y-3" data-testid="meshcom-grc-editor">
      <p className="text-muted text-xs">{t('meshcom.grc.editorHint')}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: MESHCOM_GRC_MAX_SLOTS }, (_, index) => {
          const value = draftTexts[index] ?? '';
          return (
            <label key={index} className="flex flex-col gap-0.5">
              <span className="text-muted text-xs">
                {index === 0
                  ? t('meshcom.grc.slotMaster', { n: index + 1 })
                  : t('meshcom.grc.slot', { n: index + 1 })}
              </span>
              <input
                type="text"
                inputMode="numeric"
                disabled={disabled || working}
                aria-label={
                  index === 0
                    ? t('meshcom.grc.slotMasterAria', { n: index + 1 })
                    : t('meshcom.grc.slotAria', { n: index + 1 })
                }
                placeholder={t('meshcom.grc.slotPlaceholder')}
                value={value}
                onChange={(e) => {
                  setSlot(index, e.target.value);
                }}
                className={`${INPUT_BOX_CLASS} font-mono text-xs`}
              />
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || working}
          aria-label={t('meshcom.grc.applyAria')}
          onClick={() => {
            void apply();
          }}
          className="bg-brand-green text-app-bg rounded-control px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {t('meshcom.grc.apply')}
        </button>
        <button
          type="button"
          disabled={disabled || working}
          aria-label={t('meshcom.grc.clearAria')}
          onClick={() => {
            void clearAll();
          }}
          className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded-control border px-3 py-1.5 text-xs disabled:opacity-50"
        >
          {t('meshcom.grc.clear')}
        </button>
      </div>

      {onNomsgallChange ? (
        <Switch
          checked={nomsgall === 'on'}
          disabled={disabled || working}
          label={t('meshcom.grc.nomsgall')}
          description={t('meshcom.grc.nomsgallHint')}
          onChange={(next) => {
            void onNomsgallChange(next ? 'on' : 'off');
          }}
        />
      ) : null}

      <div className="space-y-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-muted text-xs">{t('meshcom.grc.searchLabel')}</span>
          <input
            type="search"
            disabled={disabled || working}
            aria-label={t('meshcom.grc.searchAria')}
            placeholder={t('meshcom.grc.searchPlaceholder')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            className={`${INPUT_BOX_CLASS} text-xs`}
          />
        </label>
        <ul className="border-ink-700 rounded-control max-h-40 overflow-y-auto border">
          {searchHits.map((g) => (
            <li key={g.id} className="border-ink-800 border-b last:border-b-0">
              <button
                type="button"
                disabled={
                  disabled || working || draftHasId(g.id) || filledCount >= MESHCOM_GRC_MAX_SLOTS
                }
                aria-label={t('meshcom.grc.addKnownAria', { prefix: g.prefix, id: g.id })}
                onClick={() => {
                  addId(g.id);
                }}
                className="hover:bg-ink-800 flex w-full items-start gap-2 px-2 py-1.5 text-left text-xs disabled:opacity-40"
              >
                <span className="text-bright-green shrink-0 font-mono">{g.prefix}</span>
                <span className="text-ink-200 min-w-0 flex-1">
                  {t(`meshcom.grc.notes.${g.noteKey}`)}
                  <span className="text-muted"> · {g.id}</span>
                  {g.reachKey ? (
                    <span className="text-muted block">{t(`meshcom.grc.reach.${g.reachKey}`)}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            disabled={disabled || working}
            aria-label={t('meshcom.grc.customIdAria')}
            placeholder={t('meshcom.grc.customIdPlaceholder')}
            value={customId}
            onChange={(e) => {
              setCustomId(e.target.value);
            }}
            className={`${INPUT_BOX_CLASS} min-w-0 flex-1 font-mono text-xs`}
          />
          <button
            type="button"
            disabled={
              disabled ||
              working ||
              !isMeshcomGroupDest(customId.trim()) ||
              filledCount >= MESHCOM_GRC_MAX_SLOTS
            }
            aria-label={t('meshcom.grc.addCustomAria')}
            onClick={() => {
              const id = Number.parseInt(customId.trim(), 10);
              addId(id);
              setCustomId('');
            }}
            className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded-control border px-3 py-1 text-xs disabled:opacity-50"
          >
            {t('meshcom.grc.add')}
          </button>
        </div>
      </div>
    </div>
  );
}
