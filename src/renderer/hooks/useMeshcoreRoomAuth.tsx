import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { meshcoreGetRoomSession, meshcoreIsRoomLoggedIn } from '@/renderer/lib/meshcoreRoomSession';

export type RoomAuthMode = 'guest' | 'admin';

interface PendingRoomAuth {
  nodeId: number;
  mode: RoomAuthMode;
  roomName: string;
}

function RoomAuthFields({
  guestPassword,
  adminPassword,
  onGuestPasswordChange,
  onAdminPasswordChange,
  showAdmin,
  disabled,
  guestInputId,
  adminInputId,
}: {
  guestPassword: string;
  adminPassword: string;
  onGuestPasswordChange: (v: string) => void;
  onAdminPasswordChange: (v: string) => void;
  showAdmin: boolean;
  disabled?: boolean;
  guestInputId: string;
  adminInputId: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1">
        <label htmlFor={guestInputId} className="text-xs text-gray-400">
          {t('roomsPanel.guestPasswordLabel')}
        </label>
        <input
          id={guestInputId}
          type="password"
          autoComplete="off"
          value={guestPassword}
          onChange={(e) => {
            onGuestPasswordChange(e.target.value);
          }}
          disabled={disabled}
          placeholder={t('roomsPanel.guestPasswordPlaceholder')}
          className="bg-secondary-dark focus:border-brand-green/50 w-full rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
        />
      </div>
      {showAdmin && (
        <div className="space-y-1">
          <label htmlFor={adminInputId} className="text-xs text-gray-400">
            {t('roomsPanel.adminPasswordLabel')}
          </label>
          <input
            id={adminInputId}
            type="password"
            autoComplete="off"
            value={adminPassword}
            onChange={(e) => {
              onAdminPasswordChange(e.target.value);
            }}
            disabled={disabled}
            placeholder={t('roomsPanel.adminPasswordPlaceholder')}
            className="bg-secondary-dark focus:border-brand-green/50 w-full rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
          />
        </div>
      )}
    </div>
  );
}

export function useMeshcoreRoomAuth() {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const [pending, setPending] = useState<PendingRoomAuth | null>(null);
  const resolverRef = useRef<
    ((result: { ok: boolean; guestPassword: string; adminPassword: string }) => void) | null
  >(null);
  const guestInputId = useId();
  const adminInputId = useId();

  useEffect(() => {
    return () => {
      if (resolverRef.current) {
        resolverRef.current({ ok: false, guestPassword: '', adminPassword: '' });
        resolverRef.current = null;
      }
    };
  }, []);

  const finishModal = useCallback(
    (
      ok: boolean,
      mode: 'cancel' | 'readonly' | 'save',
      guestPassword: string,
      adminPassword: string,
    ) => {
      if (!ok || mode === 'cancel' || pending == null) {
        resolverRef.current?.({ ok: false, guestPassword: '', adminPassword: '' });
        resolverRef.current = null;
        setModalOpen(false);
        setPending(null);
        return;
      }
      resolverRef.current?.({
        ok: true,
        guestPassword: mode === 'readonly' ? '' : guestPassword,
        adminPassword,
      });
      resolverRef.current = null;
      setModalOpen(false);
      setPending(null);
    },
    [pending],
  );

  const ensureRoomAuth = useCallback(
    (
      nodeId: number,
      mode: RoomAuthMode,
      roomName: string,
    ): Promise<{
      ok: boolean;
      guestPassword: string;
      adminPassword: string;
    }> => {
      if (mode === 'guest' && meshcoreIsRoomLoggedIn(nodeId)) {
        const session = meshcoreGetRoomSession(nodeId);
        return Promise.resolve({
          ok: true,
          guestPassword: session?.guestPassword ?? '',
          adminPassword: session?.adminPassword ?? '',
        });
      }
      if (mode === 'admin' && meshcoreGetRoomSession(nodeId)?.role === 'admin') {
        const session = meshcoreGetRoomSession(nodeId)!;
        return Promise.resolve({
          ok: true,
          guestPassword: session.guestPassword,
          adminPassword: session.adminPassword,
        });
      }
      return new Promise((resolve) => {
        resolverRef.current = resolve;
        setPending({ nodeId, mode, roomName });
        setModalOpen(true);
      });
    },
    [],
  );

  const RemoteAuthModal =
    modalOpen && pending != null ? (
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
        <button
          type="button"
          className="absolute inset-0 cursor-default border-0 bg-black/60 p-0"
          aria-label={t('roomsPanel.cancelLoginDialog')}
          onClick={() => {
            finishModal(false, 'cancel', '', '');
          }}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="room-auth-title"
          className="relative z-10 w-full max-w-md space-y-3 rounded-lg border border-gray-600 bg-gray-900 p-4 shadow-xl"
        >
          <h2 id="room-auth-title" className="text-base font-semibold text-white">
            {pending.mode === 'admin'
              ? t('roomsPanel.adminLoginTitle')
              : t('roomsPanel.loginTitle')}
          </h2>
          <p className="text-sm text-gray-400">{pending.roomName}</p>
          <p className="text-sm text-gray-400">
            {pending.mode === 'admin' ? t('roomsPanel.adminLoginHelp') : t('roomsPanel.loginHelp')}
          </p>
          <ModalRoomAuthBody
            guestInputId={guestInputId}
            adminInputId={adminInputId}
            showAdmin={pending.mode === 'admin'}
            onCancel={() => {
              finishModal(false, 'cancel', '', '');
            }}
            onReadonly={() => {
              finishModal(true, 'readonly', '', '');
            }}
            onSave={(guest, admin) => {
              finishModal(true, 'save', guest, admin);
            }}
            cancelLabel={t('common.cancel')}
            readonlyLabel={t('roomsPanel.continueReadOnly')}
            continueLabel={t('roomsPanel.loginButton')}
          />
        </div>
      </div>
    ) : null;

  return { ensureRoomAuth, RemoteAuthModal };
}

function ModalRoomAuthBody({
  guestInputId,
  adminInputId,
  showAdmin,
  onCancel,
  onReadonly,
  onSave,
  cancelLabel,
  readonlyLabel,
  continueLabel,
}: {
  guestInputId: string;
  adminInputId: string;
  showAdmin: boolean;
  onCancel: () => void;
  onReadonly: () => void;
  onSave: (guestPassword: string, adminPassword: string) => void;
  cancelLabel: string;
  readonlyLabel: string;
  continueLabel: string;
}) {
  const [guestPassword, setGuestPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  return (
    <>
      <RoomAuthFields
        guestPassword={guestPassword}
        adminPassword={adminPassword}
        onGuestPasswordChange={setGuestPassword}
        onAdminPasswordChange={setAdminPassword}
        showAdmin={showAdmin}
        guestInputId={guestInputId}
        adminInputId={adminInputId}
      />
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700"
        >
          {cancelLabel}
        </button>
        {!showAdmin && (
          <button
            type="button"
            onClick={onReadonly}
            className="rounded border border-gray-600 bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-600"
          >
            {readonlyLabel}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onSave(guestPassword, adminPassword);
          }}
          className="bg-brand-green/20 text-brand-green border-brand-green/40 hover:bg-brand-green/30 rounded border px-3 py-1.5 text-xs font-medium"
        >
          {continueLabel}
        </button>
      </div>
    </>
  );
}
