import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getMeshcoreRepeaterCredential,
  setMeshcoreRepeaterCredential,
} from '@/renderer/lib/meshcoreRepeaterCredentialStorage';
import { setMeshcoreRepeaterEphemeralSecret } from '@/renderer/lib/meshcoreRepeaterSavedSecrets';
import { meshcoreRepeaterHasResolvablePassword } from '@/renderer/lib/meshcoreRepeaterSession';
import { Z_NESTED_AUTH_OVERLAY } from '@/renderer/lib/modalZIndex';

export interface RepeaterAuthResult {
  ok: boolean;
  saved?: boolean;
}

interface PendingRepeaterAuth {
  nodeId: number;
  repeaterName: string;
  /** When true, show modal even if a saved credential exists (change password). */
  forcePrompt: boolean;
}

function RepeaterRemoteAuthFields({
  password,
  onPasswordChange,
  onSubmit,
  disabled,
  passwordInputId,
}: {
  password: string;
  onPasswordChange: (v: string) => void;
  onSubmit: () => void;
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
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit();
            }
          }}
          disabled={disabled}
          placeholder={t('repeatersPanel.remoteAuthPlaceholder')}
          className="bg-secondary-dark focus:border-brand-green/50 w-full rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
        />
      </div>
    </div>
  );
}

export function useMeshcoreRepeaterRemoteAuth() {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const [pending, setPending] = useState<PendingRepeaterAuth | null>(null);
  const resolverRef = useRef<((result: RepeaterAuthResult) => void) | null>(null);
  const passwordId = useId();

  useEffect(() => {
    return () => {
      if (resolverRef.current) {
        resolverRef.current({ ok: false });
        resolverRef.current = null;
      }
    };
  }, []);

  const finishModal = useCallback(
    async (
      ok: boolean,
      mode: 'cancel' | 'skip' | 'save',
      password: string,
      rememberPassword: boolean,
      nodeId: number,
    ) => {
      if (!ok || mode === 'cancel') {
        resolverRef.current?.({ ok: false });
        resolverRef.current = null;
        setModalOpen(false);
        setPending(null);
        return;
      }
      if (mode === 'skip') {
        resolverRef.current?.({ ok: true });
        resolverRef.current = null;
        setModalOpen(false);
        setPending(null);
        return;
      }
      const trimmed = password.trim();
      let saved = false;
      // Store session password first so the awaiting admin RPC can login immediately.
      if (trimmed) {
        setMeshcoreRepeaterEphemeralSecret(nodeId, trimmed);
      }
      if (trimmed && rememberPassword) {
        try {
          await setMeshcoreRepeaterCredential(nodeId, { password: trimmed });
          saved = true;
        } catch {
          // catch-no-log-ok meshcoreRepeaterCredentialStorage already logs persist failures
        }
      }
      resolverRef.current?.({ ok: true, saved });
      resolverRef.current = null;
      setModalOpen(false);
      setPending(null);
    },
    [],
  );

  const openAuthModal = useCallback(
    (nodeId: number, repeaterName: string, forcePrompt: boolean): Promise<RepeaterAuthResult> => {
      if (!forcePrompt && meshcoreRepeaterHasResolvablePassword(nodeId)) {
        return Promise.resolve({ ok: true });
      }
      return new Promise((resolve) => {
        resolverRef.current = resolve;
        setPending({ nodeId, repeaterName, forcePrompt });
        setModalOpen(true);
      });
    },
    [],
  );

  const ensureRepeaterAuth = useCallback(
    (nodeId: number, repeaterName: string): Promise<RepeaterAuthResult> => {
      return openAuthModal(nodeId, repeaterName, false);
    },
    [openAuthModal],
  );

  const promptRepeaterPassword = useCallback(
    (nodeId: number, repeaterName: string): Promise<RepeaterAuthResult> => {
      return openAuthModal(nodeId, repeaterName, true);
    },
    [openAuthModal],
  );

  const RemoteAuthModal =
    modalOpen && pending != null ? (
      <div
        className="fixed inset-0 flex items-center justify-center p-4"
        style={{ zIndex: Z_NESTED_AUTH_OVERLAY }}
      >
        <button
          type="button"
          className="absolute inset-0 cursor-default border-0 bg-black/60 p-0"
          aria-label={t('repeatersPanel.remoteAuthCancelDialog')}
          onClick={() => {
            void finishModal(false, 'cancel', '', true, pending.nodeId);
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
          <p className="text-sm text-gray-400">{pending.repeaterName}</p>
          <p className="text-sm text-gray-400">{t('repeatersPanel.remoteAuthModalHelp')}</p>
          <ModalAuthBody
            passwordId={passwordId}
            nodeId={pending.nodeId}
            onCancel={() => {
              void finishModal(false, 'cancel', '', true, pending.nodeId);
            }}
            onSkip={() => {
              void finishModal(true, 'skip', '', true, pending.nodeId);
            }}
            onSave={(pwd, remember) => {
              void finishModal(true, 'save', pwd, remember, pending.nodeId);
            }}
            cancelLabel={t('common.cancel')}
            skipLabel={t('repeatersPanel.remoteAuthNoPassword')}
            continueLabel={t('repeatersPanel.remoteAuthContinue')}
          />
        </div>
      </div>
    ) : null;

  return { ensureRepeaterAuth, promptRepeaterPassword, RemoteAuthModal };
}

function ModalAuthBody({
  passwordId,
  nodeId,
  onCancel,
  onSkip,
  onSave,
  cancelLabel,
  skipLabel,
  continueLabel,
}: {
  passwordId: string;
  nodeId: number;
  onCancel: () => void;
  onSkip: () => void;
  onSave: (password: string, rememberPassword: boolean) => void;
  cancelLabel: string;
  skipLabel: string;
  continueLabel: string;
}) {
  const { t } = useTranslation();
  const existing = getMeshcoreRepeaterCredential(nodeId);
  const [password, setPassword] = useState(existing?.password ?? '');
  const [rememberPassword, setRememberPassword] = useState(true);
  const submitPassword = () => {
    onSave(password, rememberPassword);
  };

  return (
    <>
      <RepeaterRemoteAuthFields
        password={password}
        onPasswordChange={setPassword}
        onSubmit={submitPassword}
        passwordInputId={passwordId}
      />
      <label className="flex items-center gap-2 text-xs text-gray-400">
        <input
          type="checkbox"
          checked={rememberPassword}
          onChange={(e) => {
            setRememberPassword(e.target.checked);
          }}
        />
        {t('repeatersPanel.rememberPassword')}
      </label>
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
          onClick={submitPassword}
          className="bg-brand-green/20 text-brand-green border-brand-green/40 hover:bg-brand-green/30 rounded border px-3 py-1.5 text-xs font-medium"
        >
          {continueLabel}
        </button>
      </div>
    </>
  );
}
