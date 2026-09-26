import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  findInterfaceForHubPresetEndpoint,
  formatDefaultHubPresetEndpoint,
  RETICULUM_DEFAULT_HUB_PRESETS,
} from '@/renderer/lib/reticulum/reticulumDefaultHubPresets';
import { isReticulumLocalSerialInterface } from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import {
  enableReticulumSetupHub,
  onlineReticulumSetupInterfaces,
  readReticulumSetupSnapshot,
  type ReticulumSetupSnapshot,
  saveReticulumSetupIdentity,
} from '@/renderer/lib/reticulum/reticulumSetup';
import { writeClipboardText } from '@/renderer/lib/writeClipboardText';
import type { ReticulumIdentityStatus } from '@/renderer/stores/reticulumIdentityStore';
import { useReticulumSetupGuideStore } from '@/renderer/stores/reticulumSetupGuideStore';
import { MS_PER_SECOND } from '@/shared/timeConstants';

import { INPUT_BOX_CLASS, SELECT_BOX_CLASS } from '../ui/formClasses';

export type ReticulumSetupDestination = 'Nodes' | 'RRC' | 'Radio';

interface Props {
  running: boolean;
  apiReady: boolean;
  connecting: boolean;
  identity: ReticulumIdentityStatus | null;
  onStart: () => Promise<void>;
  onRestart: () => Promise<void>;
  onRefreshIdentity: () => Promise<void>;
  onShowInterfaces: () => void;
  onNavigate?: (destination: ReticulumSetupDestination) => boolean;
}

const HUBS = RETICULUM_DEFAULT_HUB_PRESETS.filter(
  (preset) => preset.type === 'tcp' && preset.region !== 'specialty',
);
const STEP_KEYS = [
  'reticulumSetup.startTitle',
  'reticulumSetup.identityTitle',
  'reticulumSetup.connectionTitle',
  'reticulumSetup.exploreTitle',
] as const;
const ROUTES = [
  {
    id: 'internet',
    title: 'reticulumSetup.routes.internet.title',
    body: 'reticulumSetup.routes.internet.body',
  },
  {
    id: 'radio',
    title: 'reticulumSetup.routes.radio.title',
    body: 'reticulumSetup.routes.radio.body',
  },
  {
    id: 'existing',
    title: 'reticulumSetup.routes.existing.title',
    body: 'reticulumSetup.routes.existing.body',
  },
] as const;
const PRIMARY =
  'rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50';
const SECONDARY =
  'rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 hover:bg-slate-700 disabled:opacity-50';
const SETUP_ERROR_KEYS = {
  SETUP_PRIVATE_INTERFACE: 'reticulumSetup.privateConnection',
  SETUP_INTERFACES_UNAVAILABLE: 'reticulumSetup.interfacesUnavailable',
  SETUP_IDENTITY_UNAVAILABLE: 'reticulumSetup.identityUnavailable',
  SETUP_INTERFACE_SAVE_FAILED: 'reticulumSetup.interfaceSaveFailed',
  SETUP_IDENTITY_SAVE_FAILED: 'reticulumSetup.identitySaveFailed',
} as const;

/** A reopenable field guide: explicit setup actions, live readiness, then useful destinations. */
export function ReticulumSetupGuide({
  running,
  apiReady,
  connecting,
  identity,
  onStart,
  onRestart,
  onRefreshIdentity,
  onShowInterfaces,
  onNavigate,
}: Props) {
  const { t } = useTranslation();
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const open = useReticulumSetupGuideStore((s) => s.open);
  const setOpen = useReticulumSetupGuideStore((s) => s.setOpen);
  const dismissed = useReticulumSetupGuideStore((s) => s.dismissed);
  const dismiss = useReticulumSetupGuideStore((s) => s.dismiss);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState(identity?.display_name ?? '');
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [savedWords, setSavedWords] = useState(false);
  const [route, setRoute] = useState<'internet' | 'radio' | 'existing'>('internet');
  const [hubId, setHubId] = useState(HUBS[0].id);
  const [snapshot, setSnapshot] = useState<ReticulumSetupSnapshot | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkRevision, setCheckRevision] = useState(0);
  const selectedHub = HUBS.find((hub) => hub.id === hubId) ?? HUBS[0];

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, step]);

  useEffect(() => {
    if (open && identity?.display_name) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Prefill identities loaded after the Network link opens the guide.
      setName((current) => current || identity.display_name || '');
    }
  }, [open, identity?.display_name]);

  // Poll only while the guide is checking a connection. Cleanup prevents stale successes after close.
  useEffect(() => {
    if (!open || step < 2 || !apiReady || busy) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Invalidate readiness when its live session or visible setup context ends.
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      setChecking(true);
      try {
        const next = await readReticulumSetupSnapshot(window.electronAPI.reticulum);
        if (!cancelled) {
          setSnapshot(next);
          setCheckFailed(false);
        }
      } catch (e) {
        console.debug('[ReticulumSetupGuide] readiness check failed ' + errLikeToLogString(e));
        if (!cancelled) {
          setSnapshot(null);
          setCheckFailed(true);
        }
      } finally {
        if (!cancelled) {
          setChecking(false);
          timer = setTimeout(() => {
            void check();
          }, 5 * MS_PER_SECOND);
        }
      }
    };
    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, step, apiReady, busy, checkRevision]);

  const online = snapshot ? onlineReticulumSetupInterfaces(snapshot) : [];
  const connectionAvailable =
    route === 'internet'
      ? Boolean(findInterfaceForHubPresetEndpoint(online, selectedHub))
      : route === 'radio'
        ? online.some((row) => isReticulumLocalSerialInterface(row.type))
        : online.length > 0;
  const ready =
    apiReady &&
    !busy &&
    !checkFailed &&
    identity?.configured === true &&
    snapshot?.rnsReady === true &&
    snapshot.messagingReady &&
    connectionAvailable;

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      const detail = errLikeToLogString(e);
      console.warn('[ReticulumSetupGuide] setup action failed ' + detail);
      const matched = Object.entries(SETUP_ERROR_KEYS).find(([code]) => detail.includes(code));
      setError(matched ? t(matched[1]) : detail);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const move = (next: number) => {
    setStep(next);
    setError(null);
    setNotice(null);
  };
  const navigate = (destination: ReticulumSetupDestination) => {
    if (onNavigate?.(destination)) setOpen(false);
    else setError(t('reticulumSetup.tabUnavailable'));
  };

  if (dismissed && !open) return null;

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="bg-deep-black overflow-hidden rounded-xl border border-amber-700/60"
    >
      <div className="bg-secondary-dark flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-xs font-medium text-amber-300">{t('reticulumSetup.eyebrow')}</p>
          <h2 id={`${id}-title`} className="mt-1 text-lg font-semibold text-gray-100">
            {t('reticulumSetup.title')}
          </h2>
          {!open && (
            <p className="mt-1 max-w-lg text-sm text-gray-300">{t('reticulumSetup.intro')}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {!open && (
            <button
              type="button"
              className={SECONDARY}
              disabled={busy}
              aria-expanded={open}
              aria-controls={`${id}-body`}
              aria-label={t('reticulumSetup.open')}
              onClick={() => {
                if (!open) setName(identity?.display_name ?? name);
                setOpen(true);
              }}
            >
              {t('reticulumSetup.open')}
            </button>
          )}
          <button
            type="button"
            className={SECONDARY}
            disabled={busy}
            aria-label={t('reticulumSetup.hide')}
            onClick={dismiss}
          >
            {t('reticulumSetup.hide')}
          </button>
        </div>
      </div>
      {open && (
        <div id={`${id}-body`} className="space-y-5 p-5">
          <ol
            aria-label={t('reticulumSetup.stepsLabel')}
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {STEP_KEYS.map((key, index) => (
              <li
                key={key}
                aria-current={step === index ? 'step' : undefined}
                className={`border-t-2 pt-2 text-xs ${step === index ? 'border-amber-400 text-amber-300' : 'border-gray-700 text-gray-400'}`}
              >
                <span className="mr-2 font-mono">{index + 1}</span>
                {t(key)}
              </li>
            ))}
          </ol>
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold text-gray-100 outline-none"
          >
            {t(STEP_KEYS[step])}
          </h3>

          {step === 0 && (
            <div className="space-y-4 text-sm text-gray-300">
              <p>{t('reticulumSetup.startBody')}</p>
              <p>{t('reticulumSetup.startHint')}</p>
              <button
                type="button"
                className={PRIMARY}
                disabled={busy || connecting}
                aria-label={t('reticulumSetup.startAction')}
                onClick={() => {
                  void run(async () => {
                    if (!running) await onStart();
                    move(1);
                  });
                }}
              >
                {busy || connecting ? t('reticulumSetup.working') : t('reticulumSetup.startAction')}
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4 text-sm text-gray-300">
              <p>{t('reticulumSetup.identityBody')}</p>
              {identity?.configured && (
                <p className="bg-secondary-dark rounded-lg p-3">
                  {t('reticulumSetup.existingIdentity')}
                </p>
              )}
              <label htmlFor={`${id}-name`} className="block font-medium">
                {t('reticulumSetup.nameLabel')}
              </label>
              <input
                id={`${id}-name`}
                aria-label={t('reticulumSetup.nameLabel')}
                value={name}
                maxLength={64}
                disabled={busy || Boolean(mnemonic)}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                className={`${INPUT_BOX_CLASS} w-full`}
              />
              <p className="text-xs text-gray-400">{t('reticulumSetup.nameHint')}</p>
              {!mnemonic && (
                <button
                  type="button"
                  className={PRIMARY}
                  disabled={!apiReady || busy || !name.trim()}
                  aria-label={t('reticulumSetup.saveIdentity')}
                  onClick={() => {
                    void run(async () => {
                      const result = await saveReticulumSetupIdentity(
                        window.electronAPI.reticulum,
                        name,
                      );
                      setMnemonic(result.mnemonic);
                      setSavedWords(false);
                      await onRefreshIdentity();
                      if (!result.mnemonic) move(2);
                    });
                  }}
                >
                  {busy ? t('reticulumSetup.working') : t('reticulumSetup.saveIdentity')}
                </button>
              )}
              {mnemonic && (
                <div className="space-y-3 rounded-lg border border-amber-700 p-4">
                  <h4 className="font-semibold text-amber-300">
                    {t('reticulumSetup.backupTitle')}
                  </h4>
                  <p>{t('reticulumSetup.backupBody')}</p>
                  <p className="bg-secondary-dark rounded p-3 font-mono break-words select-all">
                    {mnemonic}
                  </p>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={savedWords}
                      aria-label={t('reticulumSetup.savedWords')}
                      onChange={(event) => {
                        setSavedWords(event.target.checked);
                      }}
                    />
                    {t('reticulumSetup.savedWords')}
                  </label>
                  <button
                    type="button"
                    className={PRIMARY}
                    disabled={!savedWords || busy}
                    aria-label={t('reticulumSetup.continue')}
                    onClick={() => {
                      setMnemonic(null);
                      move(2);
                    }}
                  >
                    {t('reticulumSetup.continue')}
                  </button>
                </div>
              )}
              {onNavigate && !mnemonic && (
                <button
                  type="button"
                  className={SECONDARY}
                  disabled={busy}
                  aria-label={t('reticulumSetup.importIdentity')}
                  onClick={() => {
                    navigate('Radio');
                  }}
                >
                  {t('reticulumSetup.importIdentity')}
                </button>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 text-sm text-gray-300">
              <p>{t('reticulumSetup.connectionBody')}</p>
              <fieldset disabled={busy} className="grid gap-2 sm:grid-cols-3">
                <legend className="sr-only">{t('reticulumSetup.routeLabel')}</legend>
                {ROUTES.map(({ id: choice, title, body }) => (
                  <label
                    key={choice}
                    className={`cursor-pointer rounded-lg border p-3 ${route === choice ? 'bg-secondary-dark border-amber-500' : 'border-gray-600'}`}
                  >
                    <input
                      type="radio"
                      name={`${id}-route`}
                      value={choice}
                      checked={route === choice}
                      aria-label={t(title)}
                      onChange={() => {
                        setRoute(choice);
                        setNotice(null);
                        setError(null);
                      }}
                    />
                    <span className="ml-2 font-semibold text-gray-100">{t(title)}</span>
                    <span className="mt-2 block text-xs leading-relaxed">{t(body)}</span>
                  </label>
                ))}
              </fieldset>
              {route === 'internet' && (
                <div className="space-y-3">
                  <label htmlFor={`${id}-hub`} className="block font-medium">
                    {t('reticulumSetup.hubLabel')}
                  </label>
                  <select
                    id={`${id}-hub`}
                    value={hubId}
                    disabled={busy}
                    aria-label={t('reticulumSetup.hubLabel')}
                    onChange={(event) => {
                      setHubId(event.target.value);
                      setNotice(null);
                    }}
                    className={`${SELECT_BOX_CLASS} w-full min-w-0`}
                  >
                    {HUBS.map((hub) => (
                      <option key={hub.id} value={hub.id}>
                        {hub.name} · {formatDefaultHubPresetEndpoint(hub)}
                      </option>
                    ))}
                  </select>
                  <p>{t('reticulumSetup.hubHint')}</p>
                  <button
                    type="button"
                    className={PRIMARY}
                    disabled={!apiReady || busy}
                    aria-label={t('reticulumSetup.connectHub')}
                    onClick={() => {
                      void run(async () => {
                        setSnapshot(null);
                        await enableReticulumSetupHub(window.electronAPI.reticulum, selectedHub);
                        await onRestart();
                        setNotice(t('reticulumSetup.hubSaved'));
                      });
                    }}
                  >
                    {busy ? t('reticulumSetup.working') : t('reticulumSetup.connectHub')}
                  </button>
                </div>
              )}
              {route === 'radio' && (
                <div className="space-y-3">
                  <ol className="list-decimal space-y-2 pl-5">
                    <li>{t('reticulumSetup.radioDevice')}</li>
                    <li>{t('reticulumSetup.radioSettings')}</li>
                    <li>{t('reticulumSetup.radioCheck')}</li>
                  </ol>
                  <button
                    type="button"
                    className={SECONDARY}
                    disabled={busy || !apiReady}
                    aria-label={t('reticulumSetup.openInterfaces')}
                    onClick={onShowInterfaces}
                  >
                    {t('reticulumSetup.openInterfaces')}
                  </button>
                </div>
              )}
              {route === 'existing' && <p>{t('reticulumSetup.existingHint')}</p>}
              <div
                className="bg-deep-black space-y-2 rounded-xl border border-slate-800 p-4"
                role="status"
                aria-live="polite"
              >
                <p className="font-semibold text-gray-100">
                  {t(ready ? 'reticulumSetup.ready' : 'reticulumSetup.checkTitle')}
                </p>
                <ul className="space-y-1">
                  <li>
                    {t('reticulumSetup.checkStack')}:{' '}
                    {t(
                      apiReady && snapshot?.rnsReady
                        ? 'reticulumSetup.available'
                        : 'reticulumSetup.waiting',
                    )}
                  </li>
                  <li>
                    {t('reticulumSetup.checkMessaging')}:{' '}
                    {t(
                      apiReady && snapshot?.messagingReady
                        ? 'reticulumSetup.available'
                        : 'reticulumSetup.waiting',
                    )}
                  </li>
                  <li>
                    {t('reticulumSetup.checkConnection')}:{' '}
                    {t(
                      apiReady && connectionAvailable
                        ? 'reticulumSetup.available'
                        : 'reticulumSetup.waiting',
                    )}
                  </li>
                </ul>
                <p className="text-xs text-gray-400">
                  {t(
                    ready
                      ? 'reticulumSetup.readyHint'
                      : checkFailed
                        ? 'reticulumSetup.checkFailed'
                        : 'reticulumSetup.waitHint',
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={SECONDARY}
                  disabled={!apiReady || busy || checking}
                  aria-label={t('reticulumSetup.checkAgain')}
                  onClick={() => {
                    setCheckRevision((value) => value + 1);
                  }}
                >
                  {t('reticulumSetup.checkAgain')}
                </button>
                <button
                  type="button"
                  className={PRIMARY}
                  disabled={!ready}
                  aria-label={t('reticulumSetup.continue')}
                  onClick={() => {
                    move(3);
                  }}
                >
                  {t('reticulumSetup.continue')}
                </button>
              </div>
              <p className="text-xs text-gray-400">{t('reticulumSetup.restartHint')}</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5 text-sm text-gray-300">
              <p>{t('reticulumSetup.exploreBody')}</p>
              {!ready && (
                <p role="status" className="text-amber-300">
                  {t('reticulumSetup.connectionLost')}
                </p>
              )}
              <div className="bg-deep-black space-y-3 rounded-xl border border-slate-800 p-4">
                <h4 className="font-semibold text-gray-100">{t('reticulumSetup.addressTitle')}</h4>
                <p>{t('reticulumSetup.addressBody')}</p>
                <code className="block break-all text-amber-300">{identity?.lxmf_hash}</code>
                <button
                  type="button"
                  className={SECONDARY}
                  disabled={busy || !identity?.lxmf_hash}
                  aria-label={t('reticulumSetup.copyAddress')}
                  onClick={() => {
                    void run(async () => {
                      await writeClipboardText(identity?.lxmf_hash ?? '');
                      setNotice(t('reticulumSetup.addressCopied'));
                    });
                  }}
                >
                  {t('reticulumSetup.copyAddress')}
                </button>
              </div>
              <ol className="list-decimal space-y-3 pl-5">
                <li>{t('reticulumSetup.firstMessage')}</li>
                <li>{t('reticulumSetup.discoveryHint')}</li>
                <li>{t('reticulumSetup.deliveryHint')}</li>
              </ol>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2 rounded-lg border border-gray-700 p-4">
                  <h4 className="font-semibold text-gray-100">{t('reticulumSetup.peersTitle')}</h4>
                  <p>{t('reticulumSetup.peersBody')}</p>
                  {onNavigate && (
                    <button
                      type="button"
                      className={PRIMARY}
                      aria-label={t('reticulumSetup.openPeers')}
                      onClick={() => {
                        navigate('Nodes');
                      }}
                    >
                      {t('reticulumSetup.openPeers')}
                    </button>
                  )}
                </div>
                <div className="space-y-2 rounded-lg border border-gray-700 p-4">
                  <h4 className="font-semibold text-gray-100">{t('reticulumSetup.roomsTitle')}</h4>
                  <p>{t('reticulumSetup.roomsBody')}</p>
                  {onNavigate && (
                    <button
                      type="button"
                      className={SECONDARY}
                      aria-label={t('reticulumSetup.openRooms')}
                      onClick={() => {
                        navigate('RRC');
                      }}
                    >
                      {t('reticulumSetup.openRooms')}
                    </button>
                  )}
                </div>
              </div>
              <p>{t('reticulumSetup.networkHint')}</p>
              {onNavigate && (
                <button
                  type="button"
                  className={SECONDARY}
                  aria-label={t('reticulumSetup.openNetwork')}
                  onClick={() => {
                    navigate('Radio');
                  }}
                >
                  {t('reticulumSetup.openNetwork')}
                </button>
              )}
            </div>
          )}

          {!apiReady && step > 0 && (
            <div role="status" className="space-y-2 text-sm text-amber-300">
              <p>{t('reticulumSetup.stopped')}</p>
              <button
                type="button"
                className={SECONDARY}
                disabled={busy || connecting}
                aria-label={t('reticulumSetup.restartService')}
                onClick={() => {
                  void run(onStart);
                }}
              >
                {t('reticulumSetup.restartService')}
              </button>
            </div>
          )}
          {notice && (
            <p role="status" className="text-sm text-gray-200">
              {notice}
            </p>
          )}
          {error && (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-red-700 p-3 text-sm text-red-300"
            >
              <p>{t('reticulumSetup.actionFailed')}</p>
              <details>
                <summary>{t('reticulumSetup.errorDetails')}</summary>
                <p className="mt-2 break-words">{error}</p>
              </details>
            </div>
          )}
          {step > 0 && (
            <button
              type="button"
              className={SECONDARY}
              disabled={busy || Boolean(mnemonic)}
              aria-label={t('reticulumSetup.back')}
              onClick={() => {
                move(step - 1);
              }}
            >
              {t('reticulumSetup.back')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
