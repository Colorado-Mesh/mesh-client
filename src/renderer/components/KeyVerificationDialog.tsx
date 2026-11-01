import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatKeyVerificationSecurityNumber } from '../lib/meshtastic/meshtasticKeyVerification';
import { Z_NESTED_AUTH_OVERLAY } from '../lib/modalZIndex';
import {
  cancelKeyVerification,
  confirmKeyVerification,
  dismissKeyVerification,
  submitKeyVerificationSecurityNumber,
  useKeyVerificationStore,
} from '../stores/keyVerificationStore';
import { Button } from './ui/Button';
import { INPUT_BOX_SM_CLASS, NOTICE_CLASS } from './ui/formClasses';

/**
 * Meshtastic key-verification wizard. Mounted once from `App.tsx`; driven by
 * `useKeyVerificationStore`, so it also appears on the responder radio when a peer starts
 * verification (the radio reports it via `clientNotification`).
 *
 * Protocol exception: Meshtastic only (firmware KEY_VERIFICATION_APP); the store stays idle
 * for MeshCore / Reticulum so nothing renders.
 */
export function KeyVerificationDialog() {
  const { t } = useTranslation();
  const session = useKeyVerificationStore((s) => s.session);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const open = session != null;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      cancelKeyVerification();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!session) return null;

  const name = session.remoteLongname.trim() || t('keyVerification.dialog.unknownNode');
  const terminal =
    session.phase === 'done' || session.phase === 'rejected' || session.phase === 'error';

  let body: ReactNode = null;
  switch (session.phase) {
    case 'initiating':
      body = (
        <p className="text-muted text-sm">{t('keyVerification.dialog.initiatingHint', { name })}</p>
      );
      break;
    case 'showNumber':
      body = (
        <>
          <p className="text-muted text-sm">
            {t('keyVerification.dialog.showNumberHint', { name })}
          </p>
          <div className="space-y-1 text-center">
            <p className="text-muted text-xs">{t('keyVerification.dialog.securityNumberLabel')}</p>
            <p
              className="text-ink-100 font-mono text-3xl tracking-widest"
              data-testid="key-verification-security-number"
            >
              {formatKeyVerificationSecurityNumber(session.securityNumber ?? 0)}
            </p>
          </div>
        </>
      );
      break;
    case 'enterNumber':
      body = (
        <EnterNumberForm
          key={String(session.nonce)}
          name={name}
          invalid={session.errorCode === 'invalid_number'}
          inputId={`${titleId}-number`}
        />
      );
      break;
    case 'awaitingFinal':
      body = (
        <p className="text-muted text-sm">
          {t('keyVerification.dialog.awaitingFinalHint', { name })}
        </p>
      );
      break;
    case 'compare':
      body = (
        <>
          <p className="text-muted text-sm">{t('keyVerification.dialog.compareHint', { name })}</p>
          <div className="space-y-1 text-center">
            <p className="text-muted text-xs">
              {t('keyVerification.dialog.verificationCharactersLabel')}
            </p>
            <p
              className="text-ink-100 font-mono text-3xl tracking-widest"
              data-testid="key-verification-characters"
            >
              {session.verificationCharacters}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              aria-label={t('keyVerification.dialog.confirmMatch')}
              onClick={() => {
                void confirmKeyVerification(true);
              }}
            >
              {t('keyVerification.dialog.confirmMatch')}
            </Button>
            <Button
              variant="danger"
              aria-label={t('keyVerification.dialog.confirmMismatch')}
              onClick={() => {
                void confirmKeyVerification(false);
              }}
            >
              {t('keyVerification.dialog.confirmMismatch')}
            </Button>
          </div>
        </>
      );
      break;
    case 'done':
      body = (
        <p role="status" className={NOTICE_CLASS.success}>
          {t('keyVerification.dialog.doneHint', { name })}
        </p>
      );
      break;
    case 'rejected':
      body = (
        <p role="status" className={NOTICE_CLASS.warn}>
          {t('keyVerification.dialog.rejectedHint', { name })}
        </p>
      );
      break;
    case 'error':
      body = (
        <p role="alert" className={NOTICE_CLASS.error}>
          {t('keyVerification.dialog.sendFailed')}
        </p>
      );
      break;
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: Z_NESTED_AUTH_OVERLAY }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-deep-black rounded-modal shadow-level-3 border-ink-600 relative mx-4 w-full max-w-sm space-y-4 border p-6"
      >
        <h3 id={titleId} className="text-ink-200 text-lg font-semibold">
          {t('keyVerification.dialog.titleWithNode', { name })}
        </h3>
        {body}
        <div className="flex justify-end">
          {terminal ? (
            <Button
              variant="secondary"
              aria-label={t('keyVerification.dialog.close')}
              onClick={dismissKeyVerification}
            >
              {t('keyVerification.dialog.close')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              aria-label={t('keyVerification.dialog.cancel')}
              onClick={cancelKeyVerification}
            >
              {t('keyVerification.dialog.cancel')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function EnterNumberForm({
  name,
  invalid,
  inputId,
}: {
  name: string;
  invalid: boolean;
  inputId: string;
}) {
  const { t } = useTranslation();
  const [numberInput, setNumberInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submitKeyVerificationSecurityNumber(numberInput);
      }}
    >
      <p className="text-muted text-sm">{t('keyVerification.dialog.enterNumberHint', { name })}</p>
      <label className="text-muted block text-xs" htmlFor={inputId}>
        {t('keyVerification.dialog.enterNumberLabel', { name })}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={numberInput}
        onChange={(e) => {
          setNumberInput(e.target.value);
        }}
        placeholder={t('keyVerification.dialog.enterNumberPlaceholder')}
        aria-label={t('keyVerification.dialog.enterNumberLabel', { name })}
        className={`${INPUT_BOX_SM_CLASS} w-full font-mono`}
      />
      {invalid && (
        <p role="alert" className={NOTICE_CLASS.error}>
          {t('keyVerification.dialog.invalidNumber')}
        </p>
      )}
      <Button type="submit" variant="primary" aria-label={t('keyVerification.dialog.submitNumber')}>
        {t('keyVerification.dialog.submitNumber')}
      </Button>
    </form>
  );
}
