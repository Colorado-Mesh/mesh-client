/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import type { MeshCoreSelfInfo } from '../lib/meshcore/meshcoreHookTypes';
import {
  MESHCORE_AUTOADD_MAX_HOPS_WIRE_MAX,
  type MeshcoreAutoaddWireState,
  splitAutoaddConfigByte,
} from '../lib/meshcoreContactAutoAdd';
import { useToast } from './Toast';

function parseMaxHopsInput(raw: string): { wire: number; invalid: boolean } {
  const trimmed = raw.trim();
  if (trimmed === '') return { wire: 0, invalid: false };
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0 || n > 63) {
    return { wire: 0, invalid: true };
  }
  return { wire: n, invalid: false };
}

export default function MeshcoreContactSettingsSection({
  selfInfo,
  autoadd,
  disabled,
  applying,
  meshcoreContactsShowPublicKeys,
  onMeshcoreContactsShowPublicKeysChange,
  meshcoreContactsShowRefreshControl,
  onMeshcoreContactsShowRefreshControlChange,
  onApply,
  onClearAllContacts,
}: {
  selfInfo: MeshCoreSelfInfo;
  autoadd: MeshcoreAutoaddWireState | null;
  disabled: boolean;
  applying: boolean;
  meshcoreContactsShowPublicKeys: boolean;
  onMeshcoreContactsShowPublicKeysChange: (value: boolean) => void;
  meshcoreContactsShowRefreshControl: boolean;
  onMeshcoreContactsShowRefreshControlChange: (value: boolean) => void;
  onApply: (params: {
    autoAddAll: boolean;
    overwriteOldest: boolean;
    chat: boolean;
    repeater: boolean;
    roomServer: boolean;
    sensor: boolean;
    maxHopsWire: number;
  }) => Promise<void>;
  onClearAllContacts?: () => Promise<void>;
}) {
  const { addToast } = useToast();
  const { t } = useTranslation();
  const modeGroupId = useId();
  const [clearingAll, setClearingAll] = useState(false);
  const [autoAddAll, setAutoAddAll] = useState(!selfInfo.manualAddContacts);
  const [overwriteOldest, setOverwriteOldest] = useState(false);
  const [chat, setChat] = useState(false);
  const [repeater, setRepeater] = useState(false);
  const [roomServer, setRoomServer] = useState(false);
  const [sensor, setSensor] = useState(false);
  const [maxHopsInput, setMaxHopsInput] = useState('');
  const [hopsError, setHopsError] = useState<string | null>(null);

  useEffect(() => {
    setAutoAddAll(!selfInfo.manualAddContacts);
    const bits = splitAutoaddConfigByte(autoadd?.autoaddConfig ?? 0);
    setOverwriteOldest(bits.overwriteOldest);
    setChat(bits.chat);
    setRepeater(bits.repeater);
    setRoomServer(bits.roomServer);
    setSensor(bits.sensor);
    const hops = autoadd?.autoaddMaxHops ?? 0;
    setMaxHopsInput(hops === 0 ? '' : String(hops));
    setHopsError(null);
  }, [selfInfo.manualAddContacts, autoadd?.autoaddConfig, autoadd?.autoaddMaxHops]);

  const triggerApply = (overrides: Partial<Parameters<typeof onApply>[0]> = {}) => {
    const { wire, invalid } = parseMaxHopsInput(maxHopsInput);
    if (invalid) {
      setHopsError(t('meshcoreContactSettings.maxHopsInvalid'));
      return;
    }
    void onApply({
      autoAddAll,
      overwriteOldest,
      chat,
      repeater,
      roomServer,
      sensor,
      maxHopsWire: wire,
      ...overrides,
    });
  };

  return (
    <details className="group bg-deep-black/50 rounded-lg border border-gray-700">
      <summary className="flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 font-medium text-gray-200 transition-colors hover:bg-gray-800">
        <span>{t('meshcoreContactSettings.contactManagement')}</span>
        <svg
          className="text-muted h-4 w-4 transition-transform group-open:rotate-180"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="space-y-4 px-4 pb-4">
        <p className="text-muted text-xs">{t('meshcoreContactSettings.intro')}</p>
        <fieldset
          className="space-y-3 rounded-lg border border-gray-600/80 p-3"
          disabled={disabled || applying}
        >
          <legend className="px-1 text-sm font-medium text-gray-200">
            {t('meshcoreContactSettings.autoAddModeLegend')}
          </legend>
          <div className="hover:bg-secondary-dark/50 flex gap-2 rounded-md p-1.5">
            <input
              id={`${modeGroupId}-all`}
              type="radio"
              name={modeGroupId}
              checked={autoAddAll}
              onChange={() => {
                setAutoAddAll(true);
                triggerApply({ autoAddAll: true });
              }}
              disabled={disabled || applying}
              className="mt-1"
            />
            <label
              htmlFor={`${modeGroupId}-all`}
              className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5"
            >
              <span className="text-sm text-gray-200">
                {t('meshcoreContactSettings.autoAddAllTitle')}
              </span>
              <span className="text-muted text-xs">
                {t('meshcoreContactSettings.autoAddAllDesc')}
              </span>
            </label>
          </div>
          <div className="hover:bg-secondary-dark/50 flex gap-2 rounded-md p-1.5">
            <input
              id={`${modeGroupId}-selected`}
              type="radio"
              name={modeGroupId}
              checked={!autoAddAll}
              onChange={() => {
                setAutoAddAll(false);
                triggerApply({ autoAddAll: false });
              }}
              disabled={disabled || applying}
              className="mt-1"
            />
            <label
              htmlFor={`${modeGroupId}-selected`}
              className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5"
            >
              <span className="text-sm text-gray-200">
                {t('meshcoreContactSettings.autoAddSelectedTitle')}
              </span>
              <span className="text-muted text-xs">
                {t('meshcoreContactSettings.autoAddSelectedDesc')}
              </span>
            </label>
          </div>
        </fieldset>

        <div
          className={`space-y-2 rounded-lg border border-gray-600/60 p-3 ${autoAddAll ? 'opacity-50' : ''}`}
          aria-disabled={autoAddAll}
        >
          <p className="text-xs font-medium text-gray-300">
            {t('meshcoreContactSettings.autoAddTypesHeading')}
          </p>
          {[
            {
              id: 'meshcore-autoadd-chat',
              label: t('meshcoreContactSettings.typeChatUsers'),
              checked: chat,
              onChange: (val: boolean) => {
                setChat(val);
                triggerApply({ chat: val });
              },
            },
            {
              id: 'meshcore-autoadd-rep',
              label: t('meshcoreContactSettings.typeRepeaters'),
              checked: repeater,
              onChange: (val: boolean) => {
                setRepeater(val);
                triggerApply({ repeater: val });
              },
            },
            {
              id: 'meshcore-autoadd-room',
              label: t('meshcoreContactSettings.typeRoomServers'),
              checked: roomServer,
              onChange: (val: boolean) => {
                setRoomServer(val);
                triggerApply({ roomServer: val });
              },
            },
            {
              id: 'meshcore-autoadd-sens',
              label: t('meshcoreContactSettings.typeSensors'),
              checked: sensor,
              onChange: (val: boolean) => {
                setSensor(val);
                triggerApply({ sensor: val });
              },
            },
          ].map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3">
              <label htmlFor={row.id} className="text-sm text-gray-200">
                {row.label}
              </label>
              <input
                id={row.id}
                type="checkbox"
                checked={row.checked}
                onChange={(e) => {
                  row.onChange(e.target.checked);
                }}
                disabled={disabled || applying || autoAddAll}
                className="h-4 w-4 shrink-0"
                aria-label={row.label}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-600/60 p-3">
          <div>
            <label htmlFor="meshcore-overwrite-oldest" className="text-sm text-gray-200">
              {t('meshcoreContactSettings.overwriteOldestTitle')}
            </label>
            <p className="text-muted mt-0.5 text-xs">
              {t('meshcoreContactSettings.overwriteOldestHelp')}
            </p>
          </div>
          <input
            id="meshcore-overwrite-oldest"
            type="checkbox"
            checked={overwriteOldest}
            onChange={(e) => {
              const val = e.target.checked;
              setOverwriteOldest(val);
              triggerApply({ overwriteOldest: val });
            }}
            disabled={disabled || applying}
            className="h-4 w-4 shrink-0"
            aria-label={t('meshcoreContactSettings.overwriteOldest')}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="meshcore-autoadd-max-hops" className="text-sm text-gray-200">
            {t('meshcoreContactSettings.maxHopsLabel')}
          </label>
          <p className="text-muted text-xs">
            {t('meshcoreContactSettings.maxHopsHelp', {
              uiMax: Math.min(63, MESHCORE_AUTOADD_MAX_HOPS_WIRE_MAX),
              wireMax: MESHCORE_AUTOADD_MAX_HOPS_WIRE_MAX,
            })}
          </p>
          <input
            id="meshcore-autoadd-max-hops"
            type="text"
            inputMode="numeric"
            placeholder={t('meshcoreContactSettings.noLimitPlaceholder')}
            value={maxHopsInput}
            onChange={(e) => {
              setMaxHopsInput(e.target.value);
              setHopsError(null);
            }}
            onBlur={() => {
              triggerApply();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                triggerApply();
              }
            }}
            disabled={disabled || applying}
            className="bg-secondary-dark focus:border-brand-green w-full rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
            aria-invalid={Boolean(hopsError)}
            aria-describedby={hopsError ? 'meshcore-autoadd-hops-err' : undefined}
          />
          {hopsError && (
            <p id="meshcore-autoadd-hops-err" className="text-xs text-red-400">
              {hopsError}
            </p>
          )}
        </div>

        <div className="space-y-3 border-t border-gray-600/80 pt-4">
          <p className="text-xs font-medium tracking-wide text-gray-400 uppercase">
            {t('meshcoreContactSettings.contactsListAppHeading')}
          </p>
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-sm text-gray-200">
                {t('meshcoreContactSettings.showRefreshLabel')}
              </span>
              <p className="text-muted mt-0.5 text-xs">
                {t('meshcoreContactSettings.showRefreshDesc')}
              </p>
            </div>
            <input
              type="checkbox"
              checked={meshcoreContactsShowRefreshControl}
              onChange={(e) => {
                onMeshcoreContactsShowRefreshControlChange(e.target.checked);
              }}
              disabled={disabled || applying}
              className="h-4 w-4 shrink-0"
              aria-label={t('meshcoreContactSettings.showRefreshControl')}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-sm text-gray-200">
                {t('meshcoreContactSettings.showPublicKeysLabel')}
              </span>
              <p className="text-muted mt-0.5 text-xs">
                {t('meshcoreContactSettings.showPublicKeysDesc')}
              </p>
            </div>
            <input
              type="checkbox"
              checked={meshcoreContactsShowPublicKeys}
              onChange={(e) => {
                onMeshcoreContactsShowPublicKeysChange(e.target.checked);
              }}
              disabled={disabled || applying}
              className="h-4 w-4 shrink-0"
              aria-label={t('meshcoreContactSettings.showPublicKeys')}
            />
          </div>
        </div>

        {onClearAllContacts ? (
          <div className="border-t border-red-900/50 pt-4">
            <p className="text-muted mb-2 text-xs">{t('meshcoreContactSettings.clearAllIntro')}</p>
            <button
              type="button"
              disabled={disabled || applying || clearingAll}
              onClick={() => {
                if (!window.confirm(t('meshcoreContactSettings.clearAllContactsConfirm'))) {
                  return;
                }
                setClearingAll(true);
                void onClearAllContacts()
                  .then(() => {
                    addToast(t('meshcoreContactSettings.allContactsCleared'), 'success');
                  })
                  .catch((e: unknown) => {
                    console.warn(
                      '[MeshcoreContactSettingsSection] clear all failed ' + errLikeToLogString(e),
                    );
                    addToast(
                      e instanceof Error
                        ? e.message
                        : t('meshcoreContactSettings.failedClearContacts'),
                      'error',
                    );
                  })
                  .finally(() => {
                    setClearingAll(false);
                  });
              }}
              className="rounded-lg border border-red-700 bg-red-950/40 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-900/50 disabled:opacity-50"
              aria-label={t('meshcoreContactSettings.clearAllContacts')}
            >
              {clearingAll
                ? t('meshcoreContactSettings.clearingContacts')
                : t('meshcoreContactSettings.clearAllContactsButton')}
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
