import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';

import type { MeshcoreCompanionRemoteActions } from '../hooks/meshcore/useMeshcoreCompanionRemote';
import { translateRepeaterCliHistoryText } from '../lib/meshcore/meshcoreMessageI18n';
import { isMeshcoreRepeaterCliDangerCommand } from '../lib/meshcoreRepeaterCliDanger';
import type { CliHistoryEntry } from '../lib/repeaterCommandService';
import { ConfirmModal } from './ConfirmModal';
import { Switch } from './ui/Switch';

export interface MeshcoreRemoteCliSectionProps {
  nodeId: number;
  remote: MeshcoreCompanionRemoteActions;
  history: readonly CliHistoryEntry[];
  onClearHistory?: (nodeId: number) => void;
  /** Radio not connected: everything is read-only. */
  disabled: boolean;
}

type AllowState = { kind: 'idle' } | { kind: 'loaded'; allowed: boolean } | { kind: 'notOnRadio' };

/** Remote CLI on another v1.18+ companion, plus our own per-contact permission (flag 0x10). */
export default function MeshcoreRemoteCliSection({
  nodeId,
  remote,
  history,
  onClearHistory,
  disabled,
}: MeshcoreRemoteCliSectionProps) {
  const { t } = useTranslation();
  const [allow, setAllow] = useState<AllowState>({ kind: 'idle' });
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [confirmAllow, setConfirmAllow] = useState(false);
  const [dangerCommand, setDangerCommand] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const loadAllow = useCallback(async () => {
    setFlagBusy(true);
    setFlagError(null);
    try {
      const allowed = await remote.getRemoteCliAllowed(nodeId);
      setAllow(allowed == null ? { kind: 'notOnRadio' } : { kind: 'loaded', allowed });
    } catch (e) {
      console.warn(
        '[MeshcoreRemoteCliSection] read remote CLI flag failed ' + errLikeToLogString(e),
      );
      setFlagError(t('meshcoreRemoteCli.flagReadFailed'));
    } finally {
      setFlagBusy(false);
    }
  }, [nodeId, remote, t]);

  const writeAllow = useCallback(
    async (allowed: boolean) => {
      setFlagBusy(true);
      setFlagError(null);
      try {
        const next = await remote.setRemoteCliAllowed(nodeId, allowed);
        setAllow(next == null ? { kind: 'notOnRadio' } : { kind: 'loaded', allowed: next });
      } catch (e) {
        console.warn(
          '[MeshcoreRemoteCliSection] write remote CLI flag failed ' + errLikeToLogString(e),
        );
        setFlagError(t('meshcoreRemoteCli.flagWriteFailed'));
      } finally {
        setFlagBusy(false);
      }
    },
    [nodeId, remote, t],
  );

  const send = useCallback(
    async (command: string, confirmedDanger: boolean) => {
      setSending(true);
      try {
        await remote.sendRemoteCli(nodeId, command, { confirmedDanger });
        setInput('');
      } catch {
        // catch-no-log-ok the runtime logs the failure and appends it to the CLI history
      } finally {
        setSending(false);
      }
    },
    [nodeId, remote],
  );

  const submit = () => {
    const command = input.trim();
    if (!command) return;
    if (isMeshcoreRepeaterCliDangerCommand(command)) {
      setDangerCommand(command);
      return;
    }
    void send(command, false);
  };

  return (
    <details
      className="group bg-deep-black/50 border-ink-700 rounded-lg border"
      onToggle={(e) => {
        if (e.currentTarget.open && allow.kind === 'idle' && !flagBusy && !disabled) {
          void loadAllow();
        }
      }}
    >
      <summary className="text-ink-200 hover:bg-ink-800 flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 font-medium transition-colors">
        <span>{t('meshcoreRemoteCli.summary')}</span>
        <DetailsChevron />
      </summary>
      <div className="space-y-4 px-4 pb-4">
        <div className="space-y-2">
          {allow.kind === 'notOnRadio' ? (
            <p className="text-muted text-sm">{t('meshcoreRemoteCli.notOnRadio')}</p>
          ) : (
            <Switch
              checked={allow.kind === 'loaded' && allow.allowed}
              onChange={(on) => {
                if (on) {
                  setConfirmAllow(true);
                } else {
                  void writeAllow(false);
                }
              }}
              label={t('meshcoreRemoteCli.allowLabel')}
              description={t('meshcoreRemoteCli.allowDescription')}
              disabled={disabled || flagBusy || allow.kind !== 'loaded'}
            />
          )}
          {flagError && <p className="text-sm text-red-400">{flagError}</p>}
        </div>

        <div className="space-y-2">
          <p className="text-muted text-xs">{t('meshcoreRemoteCli.consoleHint')}</p>
          <ol
            aria-label={t('meshcoreRemoteCli.consoleLog')}
            className="bg-app-bg border-ink-700 rounded-control max-h-48 space-y-0.5 overflow-y-auto border p-2 font-mono text-xs"
          >
            {history.length === 0 ? (
              <li className="text-muted italic">{t('repeatersPanel.cliNoCommandsYet')}</li>
            ) : (
              history.map((entry, idx) => (
                <li
                  key={`${entry.timestamp}-${idx}`}
                  className={entry.type === 'sent' ? 'text-ink-300' : 'text-ink-100'}
                >
                  {entry.type === 'sent' ? '> ' : ''}
                  {translateRepeaterCliHistoryText(t, entry.type, entry.text)}
                </li>
              ))
            )}
          </ol>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              aria-label={t('meshcoreRemoteCli.consoleInput')}
              placeholder={t('meshcoreRemoteCli.consolePlaceholder')}
              value={input}
              disabled={disabled || sending}
              onChange={(e) => {
                setInput(e.target.value);
              }}
              className="bg-secondary-dark border-ink-600 text-ink-200 rounded-control min-w-0 flex-1 border px-3 py-1.5 font-mono text-sm"
            />
            <button
              type="submit"
              disabled={disabled || sending || input.trim() === ''}
              className="bg-brand-green text-app-bg rounded-lg px-4 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {sending ? t('meshcoreRemoteCli.sending') : t('meshcoreRemoteCli.send')}
            </button>
          </form>
          {onClearHistory && history.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onClearHistory(nodeId);
              }}
              className="text-muted hover:text-ink-300 text-xs underline"
            >
              {t('repeatersPanel.cliClearHistory')}
            </button>
          )}
        </div>
      </div>
      {confirmAllow && (
        <ConfirmModal
          title={t('meshcoreRemoteCli.confirmAllow.title')}
          message={t('meshcoreRemoteCli.confirmAllow.message')}
          confirmLabel={t('meshcoreRemoteCli.confirmAllow.confirm')}
          danger
          onConfirm={() => {
            setConfirmAllow(false);
            void writeAllow(true);
          }}
          onCancel={() => {
            setConfirmAllow(false);
          }}
        />
      )}
      {dangerCommand && (
        <ConfirmModal
          title={t('repeatersPanel.cliDangerConfirmTitle')}
          message={t('repeatersPanel.cliDangerConfirmMessage', { command: dangerCommand })}
          confirmLabel={t('repeatersPanel.cliDangerConfirmAction')}
          danger
          onConfirm={() => {
            const command = dangerCommand;
            setDangerCommand(null);
            void send(command, true);
          }}
          onCancel={() => {
            setDangerCommand(null);
          }}
        />
      )}
    </details>
  );
}
