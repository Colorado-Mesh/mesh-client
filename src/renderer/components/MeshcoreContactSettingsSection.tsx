import { useEffect, useId, useState } from 'react';

import type { MeshCoreSelfInfo } from '../hooks/useMeshCore';
import {
  MESHCORE_AUTOADD_MAX_HOPS_WIRE_MAX,
  type MeshcoreAutoaddWireState,
  splitAutoaddConfigByte,
} from '../lib/meshcoreContactAutoAdd';
import { useToast } from './Toast';

function parseMaxHopsInput(raw: string): { wire: number; error: string | null } {
  const t = raw.trim();
  if (t === '') return { wire: 0, error: null };
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0 || n > 63) {
    return { wire: 0, error: 'Enter a whole number from 0 to 63, or leave blank for no limit.' };
  }
  return { wire: n, error: null };
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

  const deviceAutoAddAll = !selfInfo.manualAddContacts;
  const deviceBits = splitAutoaddConfigByte(autoadd?.autoaddConfig ?? 0);
  const deviceHops = autoadd?.autoaddMaxHops ?? 0;
  const hopsParse = parseMaxHopsInput(maxHopsInput);
  const deviceHopsInput = deviceHops === 0 ? '' : String(deviceHops);
  const hopsDirty = hopsParse.error
    ? maxHopsInput.trim() !== deviceHopsInput.trim()
    : hopsParse.wire !== deviceHops;

  const dirty =
    autoAddAll !== deviceAutoAddAll ||
    overwriteOldest !== deviceBits.overwriteOldest ||
    chat !== deviceBits.chat ||
    repeater !== deviceBits.repeater ||
    roomServer !== deviceBits.roomServer ||
    sensor !== deviceBits.sensor ||
    hopsDirty;

  return (
    <details className="group bg-deep-black/50 rounded-lg border border-gray-700">
      <summary className="flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 font-medium text-gray-200 transition-colors hover:bg-gray-800">
        <span>Contact management</span>
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
        <p className="text-muted text-xs">
          Controls how the companion radio adds contacts from heard adverts (MeshCore firmware).
          Auto add selected types only applies when &quot;Auto add selected&quot; is on; overwrite
          and max hops apply in both modes.
        </p>
        <fieldset
          className="space-y-3 rounded-lg border border-gray-600/80 p-3"
          disabled={disabled || applying}
        >
          <legend className="px-1 text-sm font-medium text-gray-200">Auto add mode</legend>
          <div className="hover:bg-secondary-dark/50 flex gap-2 rounded-md p-1.5">
            <input
              id={`${modeGroupId}-all`}
              type="radio"
              name={modeGroupId}
              checked={autoAddAll}
              onChange={() => {
                setAutoAddAll(true);
              }}
              disabled={disabled || applying}
              className="mt-1"
            />
            <label
              htmlFor={`${modeGroupId}-all`}
              className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5"
            >
              <span className="text-sm text-gray-200">Auto add all</span>
              <span className="text-muted text-xs">
                All received adverts can be added to contacts.
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
              }}
              disabled={disabled || applying}
              className="mt-1"
            />
            <label
              htmlFor={`${modeGroupId}-selected`}
              className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5"
            >
              <span className="text-sm text-gray-200">Auto add selected</span>
              <span className="text-muted text-xs">
                Only the contact types you enable below are auto-added.
              </span>
            </label>
          </div>
        </fieldset>

        <div
          className={`space-y-2 rounded-lg border border-gray-600/60 p-3 ${autoAddAll ? 'opacity-50' : ''}`}
          aria-disabled={autoAddAll}
        >
          <p className="text-xs font-medium text-gray-300">Auto-add types (selected mode only)</p>
          {[
            { id: 'meshcore-autoadd-chat', label: 'Chat users', checked: chat, onChange: setChat },
            {
              id: 'meshcore-autoadd-rep',
              label: 'Repeaters',
              checked: repeater,
              onChange: setRepeater,
            },
            {
              id: 'meshcore-autoadd-room',
              label: 'Room servers',
              checked: roomServer,
              onChange: setRoomServer,
            },
            { id: 'meshcore-autoadd-sens', label: 'Sensors', checked: sensor, onChange: setSensor },
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
              Overwrite oldest
            </label>
            <p className="text-muted mt-0.5 text-xs">
              When the contact list is full, replace the oldest non-favourite contact with new ones.
            </p>
          </div>
          <input
            id="meshcore-overwrite-oldest"
            type="checkbox"
            checked={overwriteOldest}
            onChange={(e) => {
              setOverwriteOldest(e.target.checked);
            }}
            disabled={disabled || applying}
            className="h-4 w-4 shrink-0"
            aria-label="Overwrite oldest non-favourite contacts when full"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="meshcore-autoadd-max-hops" className="text-sm text-gray-200">
            Auto add max hops
          </label>
          <p className="text-muted text-xs">
            Only auto-add if the advert path has at most this many hops. Leave blank for no limit.
            (0–{Math.min(63, MESHCORE_AUTOADD_MAX_HOPS_WIRE_MAX)}; device may clamp to{' '}
            {MESHCORE_AUTOADD_MAX_HOPS_WIRE_MAX}.)
          </p>
          <input
            id="meshcore-autoadd-max-hops"
            type="text"
            inputMode="numeric"
            placeholder="No limit"
            value={maxHopsInput}
            onChange={(e) => {
              setMaxHopsInput(e.target.value);
              setHopsError(null);
            }}
            disabled={disabled || applying}
            className="bg-secondary-dark focus:border-brand-green w-full rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
            aria-invalid={Boolean(hopsError || hopsParse.error)}
            aria-describedby={
              hopsError || hopsParse.error ? 'meshcore-autoadd-hops-err' : undefined
            }
          />
          {(hopsError || hopsParse.error) && (
            <p id="meshcore-autoadd-hops-err" className="text-xs text-red-400">
              {hopsError ?? hopsParse.error}
            </p>
          )}
        </div>

        <div className="space-y-3 border-t border-gray-600/80 pt-4">
          <p className="text-xs font-medium tracking-wide text-gray-400 uppercase">
            Contacts list (app)
          </p>
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-sm text-gray-200">Show refresh control</span>
              <p className="text-muted mt-0.5 text-xs">
                Show a refresh button on the Contacts tab (desktop substitute for pull-to-refresh).
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
              aria-label="Show refresh control on contacts list"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-sm text-gray-200">Show public keys</span>
              <p className="text-muted mt-0.5 text-xs">
                Show each contact&apos;s public key under the name.
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
              aria-label="Show public keys in contacts list"
            />
          </div>
        </div>

        <button
          type="button"
          disabled={disabled || applying || !dirty || Boolean(hopsParse.error)}
          onClick={() => {
            const { wire, error } = parseMaxHopsInput(maxHopsInput);
            if (error) {
              setHopsError(error);
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
            });
          }}
          className="bg-brand-green rounded-lg px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {applying ? 'Applying…' : 'Apply contact management'}
        </button>

        {onClearAllContacts ? (
          <div className="border-t border-red-900/50 pt-4">
            <p className="text-muted mb-2 text-xs">
              Remove every contact from the radio and clear the app&apos;s contact database. This
              cannot be undone.
            </p>
            <button
              type="button"
              disabled={disabled || applying || clearingAll}
              onClick={() => {
                if (
                  !window.confirm(
                    'Remove all contacts from the radio and clear local contact data?',
                  )
                ) {
                  return;
                }
                setClearingAll(true);
                void onClearAllContacts()
                  .then(() => {
                    addToast('All contacts cleared.', 'success');
                  })
                  .catch((e: unknown) => {
                    console.warn('[MeshcoreContactSettingsSection] clear all failed', e);
                    addToast(e instanceof Error ? e.message : 'Failed to clear contacts.', 'error');
                  })
                  .finally(() => {
                    setClearingAll(false);
                  });
              }}
              className="rounded-lg border border-red-700 bg-red-950/40 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-900/50 disabled:opacity-50"
              aria-label="Clear all MeshCore contacts"
            >
              {clearingAll ? 'Clearing…' : 'Clear all contacts'}
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
