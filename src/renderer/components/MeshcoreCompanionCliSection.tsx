import { type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';

import type { MeshcoreCompanionCliActions } from '../hooks/meshcore/useMeshcoreCompanionCli';
import {
  formatMeshcoreCompanionCliForLog,
  isMeshcoreCompanionSensitiveCommand,
} from '../lib/meshcore/meshcoreCompanionCli';
import {
  applyMeshcoreCompanionSetting,
  MESHCORE_COMPANION_SECRET_GET_COMMANDS,
  MESHCORE_COMPANION_SETTINGS,
  MESHCORE_COMPANION_WIFI_CLEAR_COMMAND,
  meshcoreCliReplyNeedsReboot,
  type MeshcoreCompanionSettingDescriptor,
  type MeshcoreCompanionSettingGroup,
  type MeshcoreCompanionSettingsSnapshot,
  readAllMeshcoreCompanionSettings,
} from '../lib/meshcore/meshcoreCompanionSettings';
import { ConfirmModal } from './ConfirmModal';
import { Switch } from './ui/Switch';

type PendingConfirm = 'reboot' | 'poweroff' | 'clearWifi' | null;

interface ConsoleEntry {
  id: number;
  kind: 'sent' | 'received' | 'error';
  text: string;
}

const MAX_CONSOLE_ENTRIES = 100;

/** i18n segment for a setting key (`wifi.ssid` → `wifi_ssid`). */
function i18nKey(key: string): string {
  return key.replace(/\./g, '_');
}

function consoleDisplay(command: string): string {
  return isMeshcoreCompanionSensitiveCommand(command)
    ? formatMeshcoreCompanionCliForLog(command)
    : command;
}

function GroupFieldset({
  anchorId,
  legend,
  children,
}: {
  anchorId: string;
  legend: string;
  children: ReactNode;
}) {
  return (
    <fieldset
      data-setting-anchor={anchorId}
      className="border-ink-600/80 space-y-3 rounded-lg border p-3"
    >
      <legend className="text-ink-200 px-1 text-sm font-medium">{legend}</legend>
      {children}
    </fieldset>
  );
}

export interface MeshcoreCompanionCliSectionProps {
  cli: MeshcoreCompanionCliActions;
  disabled: boolean;
  onToast?: (message: string, kind: 'success' | 'error') => void;
}

export default function MeshcoreCompanionCliSection({
  cli,
  disabled,
  onToast,
}: MeshcoreCompanionCliSectionProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<MeshcoreCompanionSettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [applyingGroup, setApplyingGroup] = useState<MeshcoreCompanionSettingGroup | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [rebootPending, setRebootPending] = useState(false);
  /** Group whose Apply asked for a reboot; the notice renders there so it is in view. */
  const [rebootGroup, setRebootGroup] = useState<MeshcoreCompanionSettingGroup | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const [consoleInput, setConsoleInput] = useState('');
  const [consoleLog, setConsoleLog] = useState<ConsoleEntry[]>([]);
  const [consoleBusy, setConsoleBusy] = useState(false);

  const busy = disabled || loading || applyingGroup !== null;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const snap = await readAllMeshcoreCompanionSettings(cli.run);
      setSnapshot(snap);
      setEdits({});
      setFieldErrors({});
    } catch (e) {
      console.warn('[MeshcoreCompanionCliSection] read settings failed ' + errLikeToLogString(e));
      setLoadError(t('meshcoreCompanionCli.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [cli.run, t]);

  const valueOf = (key: string): string => edits[key] ?? snapshot?.values[key] ?? '';

  const setEdit = (key: string, value: string): void => {
    setEdits((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      return Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key));
    });
  };

  const dirtyKeys = (group: MeshcoreCompanionSettingGroup): string[] =>
    MESHCORE_COMPANION_SETTINGS.filter(
      (s) =>
        s.group === group &&
        s.setCommand &&
        edits[s.key] !== undefined &&
        edits[s.key] !== (snapshot?.values[s.key] ?? ''),
    ).map((s) => s.key);

  const applyGroup = async (group: MeshcoreCompanionSettingGroup): Promise<void> => {
    const keys = dirtyKeys(group);
    const errors: Record<string, string> = {};
    for (const key of keys) {
      const s = MESHCORE_COMPANION_SETTINGS.find((d) => d.key === key);
      const err = s?.validate?.(edits[key]) ?? null;
      if (err) errors[key] = t(`meshcoreCompanionCli.validation.${err}`);
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setApplyingGroup(group);
    let needsReboot = false;
    const failed: string[] = [];
    try {
      for (const key of keys) {
        try {
          const res = await applyMeshcoreCompanionSetting(cli.run, key, edits[key]);
          if (!res.ok) {
            failed.push(key);
            errors[key] = res.reply || t('meshcoreCompanionCli.applyFailed');
          }
          needsReboot ||= res.rebootRequired;
        } catch (e) {
          console.warn(
            `[MeshcoreCompanionCliSection] apply ${key} failed ` + errLikeToLogString(e),
          );
          failed.push(key);
          errors[key] = t('meshcoreCompanionCli.applyFailed');
        }
      }
    } finally {
      setApplyingGroup(null);
    }
    setFieldErrors(errors);
    if (needsReboot) {
      setRebootPending(true);
      setRebootGroup(group);
    }
    onToast?.(
      failed.length === 0
        ? t('meshcoreCompanionCli.applied')
        : t('meshcoreCompanionCli.appliedWithErrors', { count: failed.length }),
      failed.length === 0 ? 'success' : 'error',
    );
    const kept: Record<string, string> = {};
    for (const key of failed) kept[key] = edits[key];
    try {
      const snap = await readAllMeshcoreCompanionSettings(cli.run);
      setSnapshot(snap);
    } catch (e) {
      console.warn('[MeshcoreCompanionCliSection] re-read failed ' + errLikeToLogString(e));
    }
    setEdits(kept);
  };

  const reveal = async (key: string): Promise<void> => {
    if (revealed[key]) {
      setRevealed((prev) => ({ ...prev, [key]: false }));
      return;
    }
    const getCommand = MESHCORE_COMPANION_SECRET_GET_COMMANDS[key];
    if (getCommand && edits[key] === undefined) {
      try {
        const res = await cli.run(getCommand);
        if (res.kind === 'ok') {
          const v = res.reply.trim().replace(/^>\s?/, '');
          setSnapshot((prev) => (prev ? { ...prev, values: { ...prev.values, [key]: v } } : prev));
        }
      } catch (e) {
        console.warn('[MeshcoreCompanionCliSection] reveal failed ' + errLikeToLogString(e));
        onToast?.(t('meshcoreCompanionCli.revealFailed'), 'error');
        return;
      }
    }
    setRevealed((prev) => ({ ...prev, [key]: true }));
  };

  const pushConsole = (kind: ConsoleEntry['kind'], text: string): void => {
    setConsoleLog((prev) =>
      [...prev, { id: Date.now() + Math.random(), kind, text }].slice(-MAX_CONSOLE_ENTRIES),
    );
  };

  const runConsole = async (): Promise<void> => {
    const command = consoleInput.trim();
    if (!command) return;
    const lower = command.toLowerCase();
    if (lower === 'reboot') {
      setConfirm('reboot');
      return;
    }
    if (lower === 'poweroff' || lower === 'shutdown') {
      setConfirm('poweroff');
      return;
    }
    setConsoleBusy(true);
    pushConsole('sent', consoleDisplay(command));
    try {
      const res = await cli.run(command);
      pushConsole(
        'received',
        isMeshcoreCompanionSensitiveCommand(command) ? '[redacted]' : res.reply,
      );
      if (meshcoreCliReplyNeedsReboot(res.reply)) {
        setRebootPending(true);
        setRebootGroup(null);
      }
      setConsoleInput('');
    } catch (e) {
      console.warn('[MeshcoreCompanionCliSection] console command failed ' + errLikeToLogString(e));
      pushConsole('error', e instanceof Error ? e.message : String(e));
    } finally {
      setConsoleBusy(false);
    }
  };

  const onConfirm = async (): Promise<void> => {
    const action = confirm;
    setConfirm(null);
    try {
      if (action === 'reboot') {
        setRebootPending(false);
        setRebootGroup(null);
        onToast?.(t('meshcoreCompanionCli.rebooting'), 'success');
        await cli.rebootAndReconnect();
      } else if (action === 'poweroff') {
        await cli.powerOff();
      } else if (action === 'clearWifi') {
        const res = await cli.run(MESHCORE_COMPANION_WIFI_CLEAR_COMMAND);
        if (res.kind === 'ok') {
          setRebootPending(true);
          setRebootGroup('wifi');
        }
        await load();
      }
    } catch (e) {
      console.warn(`[MeshcoreCompanionCliSection] ${action} failed ` + errLikeToLogString(e));
      onToast?.(t('meshcoreCompanionCli.actionFailed'), 'error');
    }
  };

  const copyIp = async (ip: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(ip);
      onToast?.(t('meshcoreCompanionCli.ipCopied'), 'success');
    } catch (e) {
      console.warn('[MeshcoreCompanionCliSection] copy IP failed ' + errLikeToLogString(e));
    }
  };

  const renderField = (s: MeshcoreCompanionSettingDescriptor) => {
    const k = i18nKey(s.key);
    const label = t(`meshcoreCompanionCli.settings.${k}.label`);
    const hint = t(`meshcoreCompanionCli.settings.${k}.hint`, { defaultValue: '' });
    const inputId = `meshcore-companion-${k}`;
    const error = fieldErrors[s.key];
    const unsupported = snapshot?.unsupported.includes(s.key) ?? false;
    const value = valueOf(s.key);

    if (s.kind === 'toggle') {
      return (
        <div key={s.key}>
          <Switch
            checked={value === 'on'}
            onChange={(on) => {
              setEdit(s.key, on ? 'on' : 'off');
            }}
            label={label}
            description={unsupported ? t('meshcoreCompanionCli.unsupported') : hint || undefined}
            disabled={busy || unsupported}
          />
          {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
        </div>
      );
    }

    if (s.kind === 'readonly') {
      return (
        <div key={s.key} className="flex items-center justify-between gap-4">
          <span className="text-body text-ink-200">{label}</span>
          <span className="text-body text-ink-300 font-mono">
            {unsupported ? t('meshcoreCompanionCli.unsupported') : value || '—'}
          </span>
        </div>
      );
    }

    const isSecret = s.kind === 'secret';
    const shown = isSecret && revealed[s.key];
    return (
      <div key={s.key} className="space-y-1">
        <label htmlFor={inputId} className="text-body text-ink-200 block">
          {label}
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            type={s.kind === 'number' ? 'number' : isSecret && !shown ? 'password' : 'text'}
            inputMode={s.key === 'pin' ? 'numeric' : undefined}
            autoComplete="off"
            min={s.min}
            max={s.max}
            step={s.step}
            maxLength={s.maxLength}
            value={value}
            placeholder={
              isSecret && !shown && edits[s.key] === undefined
                ? t('meshcoreCompanionCli.secretPlaceholder')
                : undefined
            }
            disabled={busy || unsupported}
            aria-invalid={error ? true : undefined}
            aria-describedby={hint ? `${inputId}-hint` : undefined}
            onChange={(e) => {
              setEdit(s.key, e.target.value);
            }}
            className="bg-secondary-dark border-ink-600 text-ink-200 rounded-control min-w-0 flex-1 border px-3 py-1.5 text-sm"
          />
          {isSecret && s.key !== 'pin' && (
            <button
              type="button"
              disabled={busy || unsupported}
              aria-label={
                shown ? t('meshcoreCompanionCli.hideSecret') : t('meshcoreCompanionCli.showSecret')
              }
              onClick={() => void reveal(s.key)}
              className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded-control border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {shown ? t('meshcoreCompanionCli.hideSecret') : t('meshcoreCompanionCli.showSecret')}
            </button>
          )}
        </div>
        {hint && (
          <p id={`${inputId}-hint`} className="text-muted text-xs">
            {hint}
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  };

  const renderRebootNotice = () => (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-orange-700 bg-orange-900/40 px-3 py-2"
    >
      <span className="text-sm text-orange-200">{t('meshcoreCompanionCli.rebootPending')}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setConfirm('reboot');
        }}
        className="text-sm font-medium text-orange-200 underline hover:text-orange-100"
      >
        {t('meshcoreCompanionCli.rebootNow')}
      </button>
    </div>
  );

  const renderGroupBody = (group: MeshcoreCompanionSettingGroup) => {
    if (group === 'wifi' && snapshot && !snapshot.wifiSupported) {
      return <p className="text-muted text-xs">{t('meshcoreCompanionCli.wifiUnsupported')}</p>;
    }
    const settings = MESHCORE_COMPANION_SETTINGS.filter((s) => s.group === group);
    const dirty = dirtyKeys(group).length > 0;
    const ip = snapshot?.values['wifi.ip'];
    return (
      <>
        {settings.map(renderField)}
        {group === 'wifi' && (
          <div className="flex flex-wrap gap-2">
            {ip && (
              <button
                type="button"
                onClick={() => void copyIp(ip)}
                aria-label={t('meshcoreCompanionCli.copyIp')}
                className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded-control border px-3 py-1.5 text-sm"
              >
                {t('meshcoreCompanionCli.copyIp')}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirm('clearWifi');
              }}
              aria-label={t('meshcoreCompanionCli.clearWifi')}
              className="rounded-control border border-red-700 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/40 disabled:opacity-50"
            >
              {t('meshcoreCompanionCli.clearWifi')}
            </button>
          </div>
        )}
        {group === 'wifi' && ip && (
          <p className="text-muted text-xs">{t('meshcoreCompanionCli.wifiTcpHint', { ip })}</p>
        )}
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => void applyGroup(group)}
          className="bg-brand-green text-app-bg rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {applyingGroup === group
            ? t('meshcoreCompanionCli.applying')
            : t('meshcoreCompanionCli.apply')}
        </button>
        {rebootPending && rebootGroup === group && renderRebootNotice()}
      </>
    );
  };

  return (
    <details
      data-setting-anchor="radio.companionCli.section"
      className="group bg-deep-black/50 border-ink-700 rounded-lg border"
      onToggle={(e) => {
        if (e.currentTarget.open && !snapshot && !loading && cli.available) {
          void load();
        }
      }}
    >
      <summary className="text-ink-200 hover:bg-ink-800 flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 font-medium transition-colors">
        <span>{t('meshcoreCompanionCli.summary')}</span>
        <DetailsChevron />
      </summary>
      <div className="space-y-4 px-4 pb-4">
        <p className="text-muted text-xs">{t('meshcoreCompanionCli.description')}</p>
        {!cli.available ? (
          <p className="text-muted text-sm">{t('meshcoreCompanionCli.requiresFirmware')}</p>
        ) : (
          <>
            {rebootPending && rebootGroup === null && renderRebootNotice()}
            {loading && <p className="text-muted text-sm">{t('meshcoreCompanionCli.loading')}</p>}
            {loadError && <p className="text-sm text-red-400">{loadError}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={() => void load()}
              className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded-control border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {t('meshcoreCompanionCli.refresh')}
            </button>
            {snapshot && (
              <>
                <GroupFieldset
                  anchorId="radio.companionCli.device"
                  legend={t('meshcoreCompanionCli.groups.device')}
                >
                  {renderGroupBody('device')}
                </GroupFieldset>
                <GroupFieldset
                  anchorId="radio.companionCli.radio"
                  legend={t('meshcoreCompanionCli.groups.radio')}
                >
                  {renderGroupBody('radio')}
                </GroupFieldset>
                <GroupFieldset
                  anchorId="radio.companionCli.wifi"
                  legend={t('meshcoreCompanionCli.groups.wifi')}
                >
                  {renderGroupBody('wifi')}
                </GroupFieldset>
              </>
            )}

            <GroupFieldset
              anchorId="radio.companionCli.power"
              legend={t('meshcoreCompanionCli.groups.power')}
            >
              <p className="text-muted text-xs">{t('meshcoreCompanionCli.powerHint')}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setConfirm('reboot');
                  }}
                  className="bg-brand-green text-app-bg rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {t('meshcoreCompanionCli.reboot')}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setConfirm('poweroff');
                  }}
                  className="rounded-lg border border-red-700 px-4 py-2 text-sm text-red-300 hover:bg-red-900/40 disabled:opacity-50"
                >
                  {t('meshcoreCompanionCli.powerOff')}
                </button>
              </div>
            </GroupFieldset>

            <GroupFieldset
              anchorId="radio.companionCli.console"
              legend={t('meshcoreCompanionCli.groups.console')}
            >
              <p className="text-muted text-xs">{t('meshcoreCompanionCli.consoleHint')}</p>
              <ol
                aria-label={t('meshcoreCompanionCli.consoleLog')}
                className="bg-app-bg border-ink-700 rounded-control max-h-48 space-y-0.5 overflow-y-auto border p-2 font-mono text-xs"
              >
                {consoleLog.map((entry) => (
                  <li
                    key={entry.id}
                    className={
                      entry.kind === 'sent'
                        ? 'text-ink-300'
                        : entry.kind === 'error'
                          ? 'text-red-400'
                          : 'text-ink-100'
                    }
                  >
                    {entry.kind === 'sent' ? `> ${entry.text}` : entry.text}
                  </li>
                ))}
              </ol>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void runConsole();
                }}
              >
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={t('meshcoreCompanionCli.consoleInput')}
                  placeholder={t('meshcoreCompanionCli.consolePlaceholder')}
                  value={consoleInput}
                  disabled={disabled || consoleBusy}
                  onChange={(e) => {
                    setConsoleInput(e.target.value);
                  }}
                  className="bg-secondary-dark border-ink-600 text-ink-200 rounded-control min-w-0 flex-1 border px-3 py-1.5 font-mono text-sm"
                />
                <button
                  type="submit"
                  disabled={disabled || consoleBusy || consoleInput.trim() === ''}
                  className="bg-brand-green text-app-bg rounded-lg px-4 py-1.5 text-sm font-medium disabled:opacity-50"
                >
                  {t('meshcoreCompanionCli.consoleSend')}
                </button>
              </form>
            </GroupFieldset>
          </>
        )}
      </div>
      {confirm && (
        <ConfirmModal
          title={t(`meshcoreCompanionCli.confirm.${confirm}.title`)}
          message={t(`meshcoreCompanionCli.confirm.${confirm}.message`)}
          confirmLabel={t(`meshcoreCompanionCli.confirm.${confirm}.confirm`)}
          danger={confirm !== 'reboot'}
          onConfirm={() => void onConfirm()}
          onCancel={() => {
            setConfirm(null);
          }}
        />
      )}
    </details>
  );
}
