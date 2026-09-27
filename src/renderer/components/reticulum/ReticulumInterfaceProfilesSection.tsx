/* eslint-disable react-hooks/set-state-in-effect -- sync default members when live enable-set drifts */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  activeInterfaceProfileId,
  applyInterfaceEnableSet,
  createInterfaceProfile,
  deleteInterfaceProfile,
  type InterfaceProfilesState,
  loadInterfaceProfiles,
  renameInterfaceProfile,
  saveCurrentAsInterfaceProfile,
  saveInterfaceProfiles,
  updateDefaultInterfaceMembersIfCustom,
} from '@/renderer/lib/reticulum/interfaceProfiles';
import type { ReticulumInterfaceRow } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';

import { INPUT_BOX_SM_CLASS } from '../ui/formClasses';

export interface ReticulumInterfaceProfilesSectionProps {
  interfaces: ReticulumInterfaceRow[];
  actionsDisabled: boolean;
  onToggle: (
    id: string,
    enabled: boolean,
    ifaceType: string,
  ) => boolean | undefined | Promise<boolean | undefined>;
  onApplied?: (needsRestartHint: boolean) => void;
}

/** Minimal NomadNet-style interface enable-set presets for the Interfaces panel. */
export function ReticulumInterfaceProfilesSection({
  interfaces,
  actionsDisabled,
  onToggle,
  onApplied,
}: ReticulumInterfaceProfilesSectionProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<InterfaceProfilesState>(() => loadInterfaceProfiles());
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    // Skip while applying a named profile so mid-toggle snapshots do not invent Default.
    if (busy) return;
    setState((prev) => {
      const next = updateDefaultInterfaceMembersIfCustom(prev, interfaces);
      if (next !== prev) saveInterfaceProfiles(next);
      return next;
    });
  }, [interfaces, busy]);

  const activeId = useMemo(() => activeInterfaceProfileId(state, interfaces), [state, interfaces]);

  const persist = (next: InterfaceProfilesState) => {
    setState(next);
    saveInterfaceProfiles(next);
  };

  const applyMembers = async (members: string[]) => {
    setBusy(true);
    try {
      const res = await applyInterfaceEnableSet(
        interfaces,
        new Set(members),
        (id, enabled, typeName) => onToggle(id, enabled, typeName ?? ''),
      );
      if (!res.ok) return;
      onApplied?.(res.needsRestartHint);
    } finally {
      setBusy(false);
    }
  };

  const disabled = actionsDisabled || busy;

  return (
    <section
      className="border-ink-700/80 bg-ink-950/40 space-y-2 rounded border p-2"
      aria-label={t('connectionPanel.reticulumInterfaces.profilesTitle')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-ink-300 text-xs font-semibold">
          {t('connectionPanel.reticulumInterfaces.profilesTitle')}
        </h3>
        <p className="text-2xs text-muted">
          {t('connectionPanel.reticulumInterfaces.profilesHint')}
        </p>
      </div>

      <ul className="space-y-1">
        {state.defaultMembers != null && state.profiles.length > 0 ? (
          <li className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              disabled={disabled || activeId != null}
              className={`rounded px-2 py-1 ${
                activeId == null
                  ? 'bg-orange-900/40 text-orange-200'
                  : 'bg-ink-800 text-ink-300 hover:bg-ink-700'
              }`}
              onClick={() => {
                void applyMembers(state.defaultMembers ?? []);
              }}
            >
              {t('connectionPanel.reticulumInterfaces.profilesDefault')}
              <span className="text-muted ml-1">({state.defaultMembers.length})</span>
            </button>
          </li>
        ) : null}
        {state.profiles.length === 0 ? (
          <li className="text-label text-muted">
            {t('connectionPanel.reticulumInterfaces.profilesEmpty')}
          </li>
        ) : (
          state.profiles.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs">
              {renameId === p.id ? (
                <>
                  <input
                    className={`${INPUT_BOX_SM_CLASS} min-w-0 flex-1`}
                    value={renameValue}
                    onChange={(e) => {
                      setRenameValue(e.target.value);
                    }}
                    aria-label={t('connectionPanel.reticulumInterfaces.profilesRenameAria', {
                      name: p.name,
                    })}
                  />
                  <button
                    type="button"
                    className="bg-ink-700 text-ink-100 rounded px-2 py-0.5"
                    disabled={disabled}
                    onClick={() => {
                      persist(renameInterfaceProfile(state, p.id, renameValue));
                      setRenameId(null);
                    }}
                  >
                    {t('connectionPanel.reticulumInterfaces.profilesSaveRename')}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={disabled}
                    className={`rounded px-2 py-1 ${
                      activeId === p.id
                        ? 'bg-orange-900/40 text-orange-200'
                        : 'bg-ink-800 text-ink-300 hover:bg-ink-700'
                    }`}
                    onClick={() => {
                      void applyMembers(p.members);
                    }}
                  >
                    {p.name || t('connectionPanel.reticulumInterfaces.profilesUnnamed')}
                    <span className="text-muted ml-1">({p.members.length})</span>
                  </button>
                  <button
                    type="button"
                    className="text-ink-400 hover:text-ink-200"
                    disabled={disabled}
                    onClick={() => {
                      setRenameId(p.id);
                      setRenameValue(p.name);
                    }}
                  >
                    {t('connectionPanel.reticulumInterfaces.profilesRename')}
                  </button>
                  <button
                    type="button"
                    className="text-red-400 hover:text-red-300"
                    disabled={disabled}
                    onClick={() => {
                      persist(deleteInterfaceProfile(state, p.id));
                    }}
                  >
                    {t('connectionPanel.reticulumInterfaces.profilesDelete')}
                  </button>
                </>
              )}
            </li>
          ))
        )}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${INPUT_BOX_SM_CLASS} min-w-[8rem] flex-1`}
          value={draftName}
          placeholder={t('connectionPanel.reticulumInterfaces.profilesNamePlaceholder')}
          onChange={(e) => {
            setDraftName(e.target.value);
          }}
          aria-label={t('connectionPanel.reticulumInterfaces.profilesNamePlaceholder')}
        />
        <button
          type="button"
          disabled={disabled}
          className="bg-ink-700 text-ink-100 hover:bg-ink-600 rounded px-2 py-1 text-xs"
          onClick={() => {
            const next = saveCurrentAsInterfaceProfile(state, draftName || 'Profile', interfaces);
            persist(next);
            setDraftName('');
          }}
        >
          {t('connectionPanel.reticulumInterfaces.profilesSaveCurrent')}
        </button>
        <button
          type="button"
          disabled={disabled}
          className="bg-ink-800 text-ink-300 hover:bg-ink-700 rounded px-2 py-1 text-xs"
          onClick={() => {
            const next = createInterfaceProfile(state, draftName || 'Profile', []);
            persist(next);
            setDraftName('');
          }}
        >
          {t('connectionPanel.reticulumInterfaces.profilesCreateEmpty')}
        </button>
      </div>
    </section>
  );
}
