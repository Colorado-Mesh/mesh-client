import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  meshcoreApplyRepeaterSessionAuth,
  meshcoreApplyRepeaterSessionAuthSkip,
  meshcoreIsRepeaterRemoteAuthTouched,
} from '@/renderer/lib/meshcoreUtils';
import { Z_NESTED_AUTH_OVERLAY } from '@/renderer/lib/modalZIndex';

function RepeaterRemoteAuthFields({
  password,
  onPasswordChange,
  disabled,
  passwordInputId,
}: {
  password: string;
  onPasswordChange: (v: string) => void;
  disabled?: boolean;
  passwordInputId: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="min-w-[12rem] flex-1 space-y-1">
        <label htmlFor={passwordInputId} className="text-xs text-gray-400">
          {t('repeatersPanel.remoteAuthLabel')}
        </label>
        <input
          id={passwordInputId}
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => {
            onPasswordChange(e.target.value);
          }}
          disabled={disabled}
          placeholder={t('repeatersPanel.remoteAuthPlaceholder')}
          className="bg-secondary-dark focus:border-brand-green/50 w-full rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
        />
      </div>
    </div>
  );
}

/** Inline banner: complete once per session before auto Status fetch and remote RPCs. */
export function MeshcoreRepeaterRemoteAuthBanner({ onConfigured }: { onConfigured: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const passwordId = useId();

  if (meshcoreIsRepeaterRemoteAuthTouched()) return null;

  return (
    <div
      className="space-y-3 rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-3"
      role="region"
      aria-label={t('repeatersPanel.remoteAccessAriaLabel')}
    >
      <p className="text-sm text-amber-100/90">{t('repeatersPanel.remoteAuthHelp')}</p>
      <RepeaterRemoteAuthFields
        password={password}
        onPasswordChange={setPassword}
        passwordInputId={passwordId}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            meshcoreApplyRepeaterSessionAuthSkip();
            onConfigured();
          }}
          className="rounded border border-gray-600 bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-600"
        >
          {t('repeatersPanel.remoteAuthContinueWithoutPassword')}
        </button>
        <button
          type="button"
          onClick={() => {
            meshcoreApplyRepeaterSessionAuth(password);
            onConfigured();
          }}
          className="bg-brand-green/20 text-brand-green border-brand-green/40 hover:bg-brand-green/30 rounded border px-3 py-1.5 text-xs font-medium transition-colors"
        >
          {t('repeatersPanel.remoteAuthSaveForSession')}
        </button>
      </div>
    </div>
  );
}

export function useMeshcoreRepeaterRemoteAuth() {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);
  const passwordId = useId();

  useEffect(() => {
    return () => {
      if (resolverRef.current) {
        resolverRef.current(false);
        resolverRef.current = null;
      }
    };
  }, []);

  const ensureConfigured = useCallback((): Promise<boolean> => {
    if (meshcoreIsRepeaterRemoteAuthTouched()) return Promise.resolve(true);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setModalOpen(true);
    });
  }, []);

  const finishModal = useCallback(
    (ok: boolean, mode: 'cancel' | 'skip' | 'save', password: string) => {
      if (!ok || mode === 'cancel') {
        resolverRef.current?.(false);
        resolverRef.current = null;
        setModalOpen(false);
        return;
      }
      if (mode === 'skip') {
        meshcoreApplyRepeaterSessionAuthSkip();
      } else {
        meshcoreApplyRepeaterSessionAuth(password);
      }
      resolverRef.current?.(true);
      resolverRef.current = null;
      setModalOpen(false);
    },
    [],
  );

  const RemoteAuthModal = modalOpen ? (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: Z_NESTED_AUTH_OVERLAY }}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default border-0 bg-black/60 p-0"
        aria-label={t('repeatersPanel.remoteAuthCancelDialog')}
        onClick={() => {
          finishModal(false, 'cancel', '');
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="repeater-remote-auth-title"
        className="relative z-10 w-full max-w-md space-y-3 rounded-lg border border-gray-600 bg-gray-900 p-4 shadow-xl"
      >
        <h2 id="repeater-remote-auth-title" className="text-base font-semibold text-white">
          {t('repeatersPanel.remoteAuthTitle')}
        </h2>
        <p className="text-sm text-gray-400">{t('repeatersPanel.remoteAuthModalHelp')}</p>
        <ModalAuthBody
          passwordId={passwordId}
          onCancel={() => {
            finishModal(false, 'cancel', '');
          }}
          onSkip={() => {
            finishModal(true, 'skip', '');
          }}
          onSave={(pwd) => {
            finishModal(true, 'save', pwd);
          }}
          cancelLabel={t('common.cancel')}
          skipLabel={t('repeatersPanel.remoteAuthNoPassword')}
          continueLabel={t('repeatersPanel.remoteAuthContinue')}
        />
      </div>
    </div>
  ) : null;

  return { ensureConfigured, RemoteAuthModal };
}

function ModalAuthBody({
  passwordId,
  onCancel,
  onSkip,
  onSave,
  cancelLabel,
  skipLabel,
  continueLabel,
}: {
  passwordId: string;
  onCancel: () => void;
  onSkip: () => void;
  onSave: (password: string) => void;
  cancelLabel: string;
  skipLabel: string;
  continueLabel: string;
}) {
  const [password, setPassword] = useState('');
  return (
    <>
      <RepeaterRemoteAuthFields
        password={password}
        onPasswordChange={setPassword}
        passwordInputId={passwordId}
      />
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="rounded border border-gray-600 bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-600"
        >
          {skipLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            onSave(password);
          }}
          className="bg-brand-green/20 text-brand-green border-brand-green/40 hover:bg-brand-green/30 rounded border px-3 py-1.5 text-xs font-medium"
        >
          {continueLabel}
        </button>
      </div>
    </>
  );
}
