import type { TFunction } from 'i18next';
import { type SyntheticEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useModalFocusTrap } from '../hooks/useModalFocusTrap';
import type { ReachCheckDialogAnswer, ReachCheckDialogState } from '../hooks/useReachCheck';
import { buttonClassName } from './ui/Button';
import { INPUT_CLASS } from './ui/formClasses';

type ErrorState = Extract<ReachCheckDialogState, { kind: 'error' }>;

function errorMessage(t: TFunction, state: ErrorState): string {
  switch (state.error) {
    case 'invalid_url':
      return t('reachCheck.errorInvalidUrl');
    case 'not_public':
      return t('reachCheck.errorNotPublic');
    case 'network':
      return t('reachCheck.errorNetwork');
    case 'http_error':
      return t('reachCheck.errorHttp');
    case 'turnstile_required':
      return t('reachCheck.errorTurnstile');
    case 'rate_limited':
      return state.retryAfterSeconds
        ? t('reachCheck.errorRateLimited', { minutes: Math.ceil(state.retryAfterSeconds / 60) })
        : t('reachCheck.errorRateLimitedLater');
    case 'not_configured':
      return t('reachCheck.errorNotConfigured');
    case 'no_observers':
      return t('reachCheck.errorNoObservers');
    case 'invalid_response':
      return t('reachCheck.errorInvalidResponse');
    case 'session_not_found':
      return t('reachCheck.errorSessionNotFound');
    case 'key-mismatch':
      return t('reachCheck.errorKeyMismatch', { name: state.name ?? '' });
    case 'slots-full':
      return t('reachCheck.errorSlotsFull');
    case 'send-failed':
      return t('reachCheck.errorSendFailed');
    case 'channel-timeout':
      return t('reachCheck.errorChannelTimeout');
    case 'add-failed':
      return t('reachCheck.errorAddFailed', { name: state.name ?? '' });
    case 'changed':
      return t('reachCheck.errorChanged');
  }
}

export interface ReachCheckDialogProps {
  state: ReachCheckDialogState;
  onAnswer: (answer: ReachCheckDialogAnswer) => void;
}

/** Dialog for the reach check steps that need the user: server address, channel, key, errors. */
export function ReachCheckDialog({ state, onAnswer }: ReachCheckDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const bodyId = useId();
  const fieldId = useId();
  const errorId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Parents render this keyed by step, so each step mounts fresh: focus moves to its first
  // control and the draft starts empty. A re-ask of the same step keeps the draft to correct.
  const [draft, setDraft] = useState('');
  const cancel = () => {
    onAnswer({ kind: 'cancel' });
  };
  useModalFocusTrap(panelRef, cancel);

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (state.kind === 'setup') onAnswer({ kind: 'save-server', url: draft });
    else if (state.kind === 'paste-key') onAnswer({ kind: 'paste-key', hex: draft });
    else if (state.kind === 'confirm-add') onAnswer({ kind: 'confirm' });
  };

  let body: string;
  let fieldLabel: string | null = null;
  let fieldError: string | null = null;
  let primaryLabel: string | null = null;
  if (state.kind === 'setup') {
    body = t('reachCheck.serverHelp');
    fieldLabel = t('reachCheck.serverLabel');
    if (state.error) {
      fieldError =
        state.error === 'not_public'
          ? t('reachCheck.serverNotPublic')
          : t('reachCheck.serverInvalid');
    }
    primaryLabel = t('reachCheck.saveAndRun');
  } else if (state.kind === 'turnstile') {
    body = t('reachCheck.turnstileBody', { host: state.host });
  } else if (state.kind === 'confirm-add') {
    body = t('reachCheck.confirmAddBody', { name: state.name, slot: state.index });
    primaryLabel = t('reachCheck.addAndRun');
  } else if (state.kind === 'paste-key') {
    body = t('reachCheck.pasteKeyBody', { name: state.name });
    fieldLabel = t('reachCheck.keyLabel');
    if (state.error) {
      fieldError =
        state.error === 'hash' ? t('reachCheck.keyWrongHash') : t('reachCheck.keyBadFormat');
    }
    primaryLabel = t('reachCheck.addAndRun');
  } else {
    body = errorMessage(t, state);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop: mouse-only dismiss; keyboard users have Escape and the Cancel button. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 cursor-pointer border-0 bg-black/60 p-0 backdrop-blur-sm"
        onClick={cancel}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="bg-deep-black rounded-modal shadow-level-3 border-ink-600 relative mx-4 w-full max-w-md border p-6"
      >
        <form className="space-y-4" onSubmit={submit} noValidate>
          <h3 id={titleId} className="text-ink-200 text-lg font-semibold">
            {t('reachCheck.dialogTitle')}
          </h3>
          <p id={bodyId} className="text-muted text-sm leading-relaxed">
            {body}
          </p>
          {fieldLabel ? (
            <div className="space-y-1">
              <label htmlFor={fieldId} className="text-ink-300 text-sm">
                {fieldLabel}
              </label>
              <input
                id={fieldId}
                type={state.kind === 'setup' ? 'url' : 'text'}
                autoComplete="off"
                spellCheck={false}
                value={draft}
                placeholder={state.kind === 'setup' ? t('reachCheck.serverPlaceholder') : undefined}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? errorId : undefined}
                onChange={(e) => {
                  setDraft(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit(e);
                }}
                className={`${INPUT_CLASS} font-mono`}
              />
              {fieldError ? (
                <p id={errorId} role="alert" className="text-xs text-red-400">
                  {fieldError}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            {state.kind === 'error' ? (
              <button type="button" onClick={cancel} className={buttonClassName('secondary')}>
                {t('common.close')}
              </button>
            ) : (
              <button type="button" onClick={cancel} className={buttonClassName('secondary')}>
                {t('common.cancel')}
              </button>
            )}
            {state.kind === 'turnstile' ? (
              <a
                href={state.origin}
                target="_blank"
                rel="noreferrer"
                onClick={cancel}
                className={buttonClassName('primary')}
              >
                {t('reachCheck.openHost', { host: state.host })}
              </a>
            ) : null}
            {primaryLabel ? (
              <button type="submit" className={buttonClassName('primary')}>
                {primaryLabel}
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
