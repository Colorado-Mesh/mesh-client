import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MeshcomDeviceCommandsActions } from '../hooks/meshcom/useMeshcomDeviceCommands';
import { getAppSettingsRaw, mergeAppSetting } from '../lib/appSettingsStorage';
import { errLikeToLogString } from '../lib/errLikeToLogString';
import {
  buildMeshcomCommandLine,
  formatMeshcomSettimeUtc,
  MESHCOM_COMMAND_GROUPS,
  MESHCOM_COMMANDS,
  type MeshcomCommandDescriptor,
  type MeshcomCommandGroup,
  redactMeshcomCommandForLog,
} from '../lib/meshcom/meshcomCommands';
import { parseStoredJson } from '../lib/parseStoredJson';
import { ConfirmModal } from './ConfirmModal';
import { SettingsCollapsible } from './ui/SettingsSection';
import { Switch } from './ui/Switch';

interface ConsoleEntry {
  id: number;
  kind: 'sent' | 'error' | 'info';
  text: string;
}

const MAX_CONSOLE_ENTRIES = 120;

function GroupFieldset({
  anchorId,
  legend,
  children,
}: {
  anchorId?: string;
  legend: string;
  children: ReactNode;
}) {
  return (
    <fieldset
      {...(anchorId ? { 'data-setting-anchor': anchorId } : {})}
      className="border-ink-600/80 space-y-3 rounded-lg border p-3"
    >
      <legend className="text-ink-200 px-1 text-sm font-medium">{legend}</legend>
      {children}
    </fieldset>
  );
}

function readAutoSettime(): boolean {
  const parsed = parseStoredJson<{ meshcomAutoSettime?: unknown }>(
    getAppSettingsRaw(),
    'MeshComDeviceCommandsSection autoSettime',
  );
  return parsed?.meshcomAutoSettime === true;
}

export interface MeshComDeviceCommandsSectionProps {
  commands: MeshcomDeviceCommandsActions;
  disabled: boolean;
  onToast?: (message: string, kind: 'success' | 'error') => void;
}

export default function MeshComDeviceCommandsSection({
  commands,
  disabled,
  onToast,
}: MeshComDeviceCommandsSectionProps) {
  const { t } = useTranslation();
  const [autoSettime, setAutoSettime] = useState(readAutoSettime);
  const [filter, setFilter] = useState('');
  const [argById, setArgById] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [consoleInput, setConsoleInput] = useState('');
  const [consoleLog, setConsoleLog] = useState<ConsoleEntry[]>([]);
  const [consoleBusy, setConsoleBusy] = useState(false);
  const [pending, setPending] = useState<{ command: string; label: string } | null>(null);
  const consoleIdRef = useRef(0);

  const pushConsole = useCallback((kind: ConsoleEntry['kind'], text: string) => {
    setConsoleLog((prev) => {
      consoleIdRef.current += 1;
      const entry: ConsoleEntry = { id: consoleIdRef.current, kind, text };
      const next = [...prev, entry];
      return next.length > MAX_CONSOLE_ENTRIES ? next.slice(-MAX_CONSOLE_ENTRIES) : next;
    });
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return MESHCOM_COMMANDS;
    return MESHCOM_COMMANDS.filter(
      (c) =>
        c.token.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.group.includes(q),
    );
  }, [filter]);

  const byGroup = useMemo(() => {
    const map = new Map<MeshcomCommandGroup, MeshcomCommandDescriptor[]>();
    for (const group of MESHCOM_COMMAND_GROUPS) map.set(group, []);
    for (const cmd of filtered) {
      map.get(cmd.group)?.push(cmd);
    }
    return map;
  }, [filtered]);

  const sendNow = useCallback(
    async (command: string) => {
      setBusy(true);
      try {
        const result = await commands.run(command);
        pushConsole('sent', redactMeshcomCommandForLog(result.command));
        onToast?.(t('meshcomDeviceCommands.sent'), 'success');
      } catch (e) {
        const msg = errLikeToLogString(e);
        console.warn('[MeshComDeviceCommands] send failed ' + msg);
        pushConsole('error', msg);
        onToast?.(t('meshcomDeviceCommands.sendFailed', { detail: msg }), 'error');
      } finally {
        setBusy(false);
      }
    },
    [commands, onToast, pushConsole, t],
  );

  const requestSend = useCallback(
    (command: string, danger: boolean | undefined, label: string) => {
      if (danger) {
        setPending({ command, label });
        return;
      }
      void sendNow(command);
    },
    [sendNow],
  );

  const runDescriptor = useCallback(
    async (descriptor: MeshcomCommandDescriptor) => {
      setBusy(true);
      try {
        const arg = argById[descriptor.id];
        const line = buildMeshcomCommandLine(descriptor, arg);
        const result = await commands.run(line);
        pushConsole('sent', redactMeshcomCommandForLog(result.command));
        onToast?.(t('meshcomDeviceCommands.sent'), 'success');
      } catch (e) {
        const msg = errLikeToLogString(e);
        console.warn('[MeshComDeviceCommands] descriptor send failed ' + msg);
        pushConsole('error', msg);
        onToast?.(t('meshcomDeviceCommands.sendFailed', { detail: msg }), 'error');
      } finally {
        setBusy(false);
      }
    },
    [argById, commands, onToast, pushConsole, t],
  );

  const onConfirmDanger = useCallback(() => {
    if (!pending) return;
    const cmd = pending.command;
    setPending(null);
    void sendNow(cmd);
  }, [pending, sendNow]);

  const runConsole = useCallback(async () => {
    const line = consoleInput.trim();
    if (!line) return;
    setConsoleBusy(true);
    try {
      const result = await commands.run(line);
      pushConsole('sent', redactMeshcomCommandForLog(result.command));
      setConsoleInput('');
    } catch (e) {
      const msg = errLikeToLogString(e);
      console.warn('[MeshComDeviceCommands] console send failed ' + msg);
      pushConsole('error', msg);
    } finally {
      setConsoleBusy(false);
    }
  }, [commands, consoleInput, pushConsole]);

  const settimePreview = formatMeshcomSettimeUtc();
  const linkOk = commands.available && !disabled;

  const groupLegend = (group: MeshcomCommandGroup): string => {
    switch (group) {
      case 'display':
        return t('meshcomDeviceCommands.groups.display');
      case 'position':
        return t('meshcomDeviceCommands.groups.position');
      case 'sensors':
        return t('meshcomDeviceCommands.groups.sensors');
      case 'identity':
        return t('meshcomDeviceCommands.groups.identity');
      case 'network':
        return t('meshcomDeviceCommands.groups.network');
      case 'gateway':
        return t('meshcomDeviceCommands.groups.gateway');
      case 'bluetooth':
        return t('meshcomDeviceCommands.groups.bluetooth');
      case 'neighbors':
        return t('meshcomDeviceCommands.groups.neighbors');
      case 'mailbox':
        return t('meshcomDeviceCommands.groups.mailbox');
      case 'debug':
        return t('meshcomDeviceCommands.groups.debug');
      case 'power':
        return t('meshcomDeviceCommands.groups.power');
      case 'misc':
        return t('meshcomDeviceCommands.groups.misc');
      default: {
        const _exhaustive: never = group;
        return _exhaustive;
      }
    }
  };

  const renderCommandRow = (cmd: MeshcomCommandDescriptor) => {
    const needsArg = cmd.argKind !== 'none' && cmd.argKind !== 'settime';
    const argValue = argById[cmd.id] ?? '';
    return (
      <div key={cmd.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="text-ink-100 font-mono text-xs">{cmd.token}</div>
          <div className="text-muted text-xs">
            {cmd.channel === 'serial' ? (
              <span className="text-orange-400">{t('meshcomDeviceCommands.serialOnly')}</span>
            ) : (
              <span>{t('meshcomDeviceCommands.appEligible')}</span>
            )}
            {cmd.restriction ? <span className="text-muted"> · {cmd.restriction}</span> : null}
          </div>
        </div>
        {cmd.argKind === 'onOff' || (cmd.argKind === 'choice' && cmd.choices) ? (
          <div className="flex flex-wrap gap-1">
            {(cmd.argKind === 'onOff' ? ['on', 'off'] : (cmd.choices ?? [])).map((choice) => (
              <button
                key={choice}
                type="button"
                disabled={!linkOk || busy}
                aria-label={t('meshcomDeviceCommands.runChoice', {
                  command: cmd.token,
                  value: choice,
                })}
                onClick={() => {
                  const line = `${cmd.token} ${choice}`;
                  if (cmd.danger) {
                    requestSend(line, true, line);
                  } else {
                    void sendNow(line);
                  }
                }}
                className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded-control border px-2 py-1 font-mono text-xs disabled:opacity-50"
              >
                {choice}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 gap-2 sm:max-w-md sm:flex-none">
            {needsArg ? (
              <input
                type={cmd.sensitive ? 'password' : 'text'}
                autoComplete="off"
                spellCheck={false}
                disabled={!linkOk || busy}
                aria-label={t('meshcomDeviceCommands.argInput', { command: cmd.token })}
                placeholder={cmd.argHint ?? ''}
                value={argValue}
                onChange={(e) => {
                  setArgById((prev) => ({ ...prev, [cmd.id]: e.target.value }));
                }}
                className="bg-secondary-dark border-ink-600 text-ink-200 rounded-control min-w-0 flex-1 border px-2 py-1 font-mono text-xs"
              />
            ) : null}
            <button
              type="button"
              disabled={
                !linkOk || busy || (needsArg && !argValue.trim() && cmd.argKind !== 'custom')
              }
              aria-label={t('meshcomDeviceCommands.runCommand', { command: cmd.token })}
              onClick={() => {
                if (cmd.argKind === 'settime') {
                  void sendNow(`--settime ${settimePreview}`);
                  return;
                }
                if (cmd.danger) {
                  try {
                    const line = buildMeshcomCommandLine(cmd, argValue);
                    requestSend(line, true, redactMeshcomCommandForLog(line));
                  } catch (e) {
                    const msg = errLikeToLogString(e);
                    console.warn('[MeshComDeviceCommands] build line failed ' + msg);
                    pushConsole('error', msg);
                  }
                  return;
                }
                void runDescriptor(cmd);
              }}
              className="bg-brand-green text-app-bg rounded-control shrink-0 px-3 py-1 text-xs font-medium disabled:opacity-50"
            >
              {t('meshcomDeviceCommands.run')}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <SettingsCollapsible
        title={t('meshcomDeviceCommands.summary')}
        titleAs="span"
        anchorId="radio.meshcomCommands.section"
      >
        <p className="text-muted text-xs">{t('meshcomDeviceCommands.description')}</p>

        <GroupFieldset
          anchorId="radio.meshcomCommands.autoSettime"
          legend={t('meshcomDeviceCommands.autoSettimeLegend')}
        >
          <Switch
            checked={autoSettime}
            disabled={disabled}
            label={t('meshcomDeviceCommands.autoSettime')}
            description={t('meshcomDeviceCommands.autoSettimeHint', { example: settimePreview })}
            onChange={(next) => {
              setAutoSettime(next);
              mergeAppSetting('meshcomAutoSettime', next, 'MeshComDeviceCommandsSection');
            }}
          />
          <button
            type="button"
            disabled={!linkOk || busy}
            aria-label={t('meshcomDeviceCommands.settimeNow')}
            onClick={() => {
              void sendNow(`--settime ${settimePreview}`);
            }}
            className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded-control border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {t('meshcomDeviceCommands.settimeNow')}
          </button>
        </GroupFieldset>

        {!commands.available ? (
          <p className="text-muted text-sm">{t('meshcomDeviceCommands.requiresSerialBle')}</p>
        ) : null}

        <div data-setting-anchor="radio.meshcomCommands.filter" className="space-y-1">
          <label htmlFor="meshcom-cmd-filter" className="text-muted text-sm">
            {t('meshcomDeviceCommands.filter')}
          </label>
          <input
            id="meshcom-cmd-filter"
            type="search"
            autoComplete="off"
            spellCheck={false}
            aria-label={t('meshcomDeviceCommands.filter')}
            placeholder={t('meshcomDeviceCommands.filterPlaceholder')}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
            }}
            className="bg-secondary-dark border-ink-600 text-ink-200 rounded-control w-full border px-3 py-1.5 text-sm"
          />
        </div>

        {MESHCOM_COMMAND_GROUPS.map((group) => {
          const rows = byGroup.get(group) ?? [];
          if (rows.length === 0) return null;
          return (
            <GroupFieldset key={group} legend={groupLegend(group)}>
              <div className="space-y-3">{rows.map(renderCommandRow)}</div>
            </GroupFieldset>
          );
        })}

        <GroupFieldset
          anchorId="radio.meshcomCommands.console"
          legend={t('meshcomDeviceCommands.groups.console')}
        >
          <p className="text-muted text-xs">{t('meshcomDeviceCommands.consoleHint')}</p>
          <ol
            aria-label={t('meshcomDeviceCommands.consoleLog')}
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
              aria-label={t('meshcomDeviceCommands.consoleInput')}
              placeholder={t('meshcomDeviceCommands.consolePlaceholder')}
              value={consoleInput}
              disabled={!linkOk || consoleBusy}
              onChange={(e) => {
                setConsoleInput(e.target.value);
              }}
              className="bg-secondary-dark border-ink-600 text-ink-200 rounded-control min-w-0 flex-1 border px-3 py-1.5 font-mono text-sm"
            />
            <button
              type="submit"
              disabled={!linkOk || consoleBusy || consoleInput.trim() === ''}
              className="bg-brand-green text-app-bg rounded-lg px-4 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {t('meshcomDeviceCommands.consoleSend')}
            </button>
          </form>
        </GroupFieldset>
      </SettingsCollapsible>

      {pending && (
        <ConfirmModal
          title={t('meshcomDeviceCommands.confirmDanger.title')}
          message={t('meshcomDeviceCommands.confirmDanger.message', { command: pending.label })}
          confirmLabel={t('meshcomDeviceCommands.confirmDanger.confirm')}
          danger
          onConfirm={onConfirmDanger}
          onCancel={() => {
            setPending(null);
          }}
        />
      )}
    </>
  );
}
