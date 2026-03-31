import { useCallback, useId, useRef, useState } from 'react';

import {
  meshcoreApplyRepeaterSessionAuth,
  meshcoreApplyRepeaterSessionAuthSkip,
  meshcoreIsRepeaterRemoteAuthTouched,
} from '@/renderer/lib/meshcoreUtils';

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
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="min-w-[12rem] flex-1 space-y-1">
        <label htmlFor={passwordInputId} className="text-xs text-gray-400">
          Repeater admin password (optional)
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
          placeholder="Leave empty if repeaters have no admin password"
          className="bg-secondary-dark focus:border-brand-green/50 w-full rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
        />
      </div>
    </div>
  );
}

/** Inline banner: complete once per session before auto Status fetch and remote RPCs. */
export function MeshcoreRepeaterRemoteAuthBanner({ onConfigured }: { onConfigured: () => void }) {
  const [password, setPassword] = useState('');
  const passwordId = useId();

  if (meshcoreIsRepeaterRemoteAuthTouched()) return null;

  return (
    <div
      className="space-y-3 rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-3"
      role="region"
      aria-label="Repeater remote access"
    >
      <p className="text-sm text-amber-100/90">
        Remote repeater Status, Neighbors, and sensor telemetry may need an admin password. Choose
        once per session — stored only in memory for this window.
      </p>
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
          Continue without password
        </button>
        <button
          type="button"
          onClick={() => {
            meshcoreApplyRepeaterSessionAuth(password);
            onConfigured();
          }}
          className="bg-brand-green/20 text-brand-green border-brand-green/40 hover:bg-brand-green/30 rounded border px-3 py-1.5 text-xs font-medium transition-colors"
        >
          Save for this session
        </button>
      </div>
    </div>
  );
}

export function useMeshcoreRepeaterRemoteAuth() {
  const [modalOpen, setModalOpen] = useState(false);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);
  const passwordId = useId();

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
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default border-0 bg-black/60 p-0"
        aria-label="Cancel repeater password dialog"
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
          Repeater admin password
        </h2>
        <p className="text-sm text-gray-400">
          Optional password for remote repeater commands. Stored for this session only in this
          window.
        </p>
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
}: {
  passwordId: string;
  onCancel: () => void;
  onSkip: () => void;
  onSave: (password: string) => void;
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
          Cancel
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="rounded border border-gray-600 bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-600"
        >
          No password
        </button>
        <button
          type="button"
          onClick={() => {
            onSave(password);
          }}
          className="bg-brand-green/20 text-brand-green border-brand-green/40 hover:bg-brand-green/30 rounded border px-3 py-1.5 text-xs font-medium"
        >
          Continue
        </button>
      </div>
    </>
  );
}
