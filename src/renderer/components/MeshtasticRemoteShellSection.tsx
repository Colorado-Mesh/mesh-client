import { type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';
import {
  closeRemoteShell,
  openRemoteShell,
  sendRemoteShellInput,
} from '@/renderer/lib/meshtastic/remoteShellSession';
import type { ProtocolCapabilities } from '@/renderer/lib/radio/BaseRadioProvider';
import {
  clearRemoteShellOutput,
  type RemoteShellErrorCode,
  useRemoteShellStore,
} from '@/renderer/stores/remoteShellStore';

import { Button } from './ui/Button';
import { INPUT_CLASS } from './ui/formClasses';

interface Props {
  /** Protocol exception: REMOTE_SHELL_APP is a Meshtastic firmware port only. */
  capabilities?: ProtocolCapabilities;
  /** Radio link is up (the shell needs the local radio to relay frames). */
  isConnected: boolean;
  /** Prefill from the remote-config target node, when one is selected. */
  targetNodeNum?: number | null;
}

/** `!abcdef12`, `0xabcdef12` (hex) or plain decimal → node number, else null. */
export function parseRemoteShellNodeInput(input: string): number | null {
  const text = input.trim().toLowerCase();
  let value: number;
  if (/^![0-9a-f]{1,8}$/.test(text)) value = parseInt(text.slice(1), 16);
  else if (/^0x[0-9a-f]{1,8}$/.test(text)) value = parseInt(text.slice(2), 16);
  else if (/^\d{1,10}$/.test(text)) value = Number(text);
  else return null;
  return Number.isInteger(value) && value > 0 && value <= 0xffffffff ? value : null;
}

const ERROR_KEYS: Record<RemoteShellErrorCode, string> = {
  open_timeout: 'remoteShell.errors.openTimeout',
  idle_timeout: 'remoteShell.errors.idleTimeout',
  send_failed: 'remoteShell.errors.sendFailed',
  remote_error: 'remoteShell.errors.remoteError',
  no_radio: 'remoteShell.errors.noRadio',
};

/**
 * Meshtastic remote shell (PTY over `REMOTE_SHELL_APP`) on the Admin tab. High-risk: gives
 * command-line access to a remote node, so it sits behind an explicit acknowledgement, shows a
 * persistent warning, never persists the transcript, and auto-closes when idle.
 */
export default function MeshtasticRemoteShellSection({
  capabilities,
  isConnected,
  targetNodeNum,
}: Props) {
  const { t } = useTranslation();
  const phase = useRemoteShellStore((s) => s.phase);
  const nodeNum = useRemoteShellStore((s) => s.nodeNum);
  const output = useRemoteShellStore((s) => s.output);
  const outputTruncated = useRemoteShellStore((s) => s.outputTruncated);
  const gapCount = useRemoteShellStore((s) => s.gapCount);
  const errorCode = useRemoteShellStore((s) => s.errorCode);
  const errorDetail = useRemoteShellStore((s) => s.errorDetail);

  const [nodeText, setNodeText] = useState(
    targetNodeNum ? `!${targetNodeNum.toString(16).padStart(8, '0')}` : '',
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [line, setLine] = useState('');
  const logRef = useRef<HTMLPreElement | null>(null);

  const parsedNode = parseRemoteShellNodeInput(nodeText);
  const active = phase === 'opening' || phase === 'open';

  // Keep the transcript pinned to the newest output.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  // Leaving the Admin tab must not leave a live shell on a remote node.
  useEffect(
    () => () => {
      closeRemoteShell();
    },
    [],
  );

  if (capabilities?.hasRemoteShell !== true) return null;

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (phase !== 'open' || line === '') return;
    if (sendRemoteShellInput(`${line}\n`)) setLine('');
  };

  return (
    <details
      className="group rounded-lg border border-red-900"
      data-testid="admin-remote-shell"
      data-setting-anchor="admin.remoteShell"
    >
      <summary className="hover:bg-ink-800 flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 text-sm font-medium text-red-400 transition-colors">
        <span>{t('remoteShell.title')}</span>
        <DetailsChevron />
      </summary>
      <div className="space-y-3 px-4 pb-4">
        <div
          role="group"
          aria-label={t('remoteShell.warningTitle')}
          className="space-y-1 rounded-lg border border-red-500/50 bg-red-950/40 p-3 text-xs text-red-200"
          data-testid="remote-shell-warning"
        >
          <p className="font-semibold">{t('remoteShell.warningTitle')}</p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>{t('remoteShell.warningAccess')}</li>
            <li>{t('remoteShell.warningChannel')}</li>
            <li>{t('remoteShell.warningSecrets')}</li>
            <li>{t('remoteShell.warningAirtime')}</li>
            <li>{t('remoteShell.warningAuthorized')}</li>
          </ul>
        </div>

        <label className="text-ink-200 flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={active}
            onChange={(e) => {
              setAcknowledged(e.target.checked);
            }}
            aria-label={t('remoteShell.acknowledge')}
          />
          <span>{t('remoteShell.acknowledge')}</span>
        </label>

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-muted flex flex-col gap-1 text-xs">
            {t('remoteShell.node')}
            <input
              type="text"
              className={`${INPUT_CLASS} w-48 font-mono`}
              value={nodeText}
              disabled={active}
              placeholder={t('remoteShell.nodePlaceholder')}
              onChange={(e) => {
                setNodeText(e.target.value);
              }}
              aria-label={t('remoteShell.node')}
              aria-invalid={nodeText !== '' && parsedNode == null}
            />
          </label>
          {active ? (
            <Button
              variant="danger"
              onClick={() => {
                closeRemoteShell();
              }}
              aria-label={t('remoteShell.disconnect')}
            >
              {t('remoteShell.disconnect')}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!isConnected || !acknowledged || parsedNode == null}
              onClick={() => {
                if (parsedNode != null) openRemoteShell(parsedNode);
              }}
              aria-label={t('remoteShell.connect')}
            >
              {t('remoteShell.connect')}
            </Button>
          )}
        </div>

        <p className="text-muted text-xs" role="status" data-testid="remote-shell-status">
          {t(`remoteShell.phase.${phase}`, {
            node: nodeNum != null ? `!${nodeNum.toString(16).padStart(8, '0')}` : '',
          })}
        </p>
        {errorCode && (
          <p className="text-xs text-red-400" role="alert" data-testid="remote-shell-error">
            {t(ERROR_KEYS[errorCode])}
            {errorDetail ? `: ${errorDetail}` : ''}
          </p>
        )}
        {gapCount > 0 && (
          <p className="text-xs text-orange-300" data-testid="remote-shell-gaps">
            {t('remoteShell.gaps', { count: gapCount })}
          </p>
        )}
        {outputTruncated && (
          <p className="text-muted text-xs">{t('remoteShell.outputTruncated')}</p>
        )}

        <pre
          ref={logRef}
          role="log"
          aria-label={t('remoteShell.outputAria')}
          // Keyboard users must be able to focus and scroll the transcript.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable log region
          tabIndex={0}
          className="bg-deep-black text-ink-200 h-64 overflow-auto rounded-lg p-3 font-mono text-xs whitespace-pre-wrap"
          data-testid="remote-shell-output"
        >
          {output}
        </pre>

        <form onSubmit={submit} className="flex gap-2">
          <input
            type="text"
            className={`${INPUT_CLASS} font-mono`}
            value={line}
            disabled={phase !== 'open'}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t('remoteShell.inputPlaceholder')}
            onChange={(e) => {
              setLine(e.target.value);
            }}
            aria-label={t('remoteShell.inputAria')}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={phase !== 'open' || line === ''}
            aria-label={t('remoteShell.send')}
          >
            {t('remoteShell.send')}
          </Button>
          <Button
            variant="ghost"
            disabled={phase !== 'open'}
            onClick={() => {
              sendRemoteShellInput('\u0003');
            }}
            aria-label={t('remoteShell.interrupt')}
          >
            {t('remoteShell.interruptShort')}
          </Button>
          <Button
            variant="ghost"
            disabled={output === ''}
            onClick={clearRemoteShellOutput}
            aria-label={t('remoteShell.clear')}
          >
            {t('remoteShell.clear')}
          </Button>
        </form>
      </div>
    </details>
  );
}
