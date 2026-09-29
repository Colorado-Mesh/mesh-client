import { Plus, X } from 'lucide-react-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  findFirstFreeMeshcoreChannelIndex,
  isValidMeshcoreHashtagChannelName,
  normalizeMeshcoreHashtagChannelName,
} from '@/renderer/lib/meshcoreChatChannelAdd';
import {
  MESHCORE_PUBLIC_CHANNEL_INDEX,
  meshcoreConfiguredChatChannels,
} from '@/renderer/lib/meshcoreConfiguredChatChannels';
import {
  MESHCORE_CHANNEL_NAME_MAX_LEN,
  meshcoreDeriveChannelKeyHexFromName,
} from '@/renderer/lib/meshcoreUtils';
import { bytesToHex, hexToBytesExactOrThrow } from '@/shared/hexBytes';

import { useToast } from './Toast';
import { INPUT_BOX_CLASS } from './ui/formClasses';

interface Props {
  channels: readonly { index: number; name: string; secret?: Uint8Array }[];
  disabled: boolean;
  onSetChannel: (index: number, name: string, secret: Uint8Array) => Promise<void>;
  onSelectChannel: (index: number) => void;
  /** Ask to remove a channel (the caller confirms). Public, in slot 0, never offers it. */
  onRemoveChannel?: (channel: { index: number; name: string }) => void;
}

export default function MeshcoreChatChannelManager({
  channels,
  disabled,
  onSetChannel,
  onSelectChannel,
  onRemoveChannel,
}: Props) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [privateChannel, setPrivateChannel] = useState(false);
  const [keyHex, setKeyHex] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedName = privateChannel ? name.trim() : normalizeMeshcoreHashtagChannelName(name);
  const validName = privateChannel
    ? normalizedName.length > 0 && normalizedName.length <= MESHCORE_CHANNEL_NAME_MAX_LEN
    : isValidMeshcoreHashtagChannelName(name);
  const normalizedKeyHex = keyHex.trim().toLowerCase();
  const validKey = /^[0-9a-f]{32}$/.test(normalizedKeyHex) && /[1-9a-f]/.test(normalizedKeyHex);
  const valid = validName && (!privateChannel || validKey);
  const configuredChannels = meshcoreConfiguredChatChannels(channels);

  const closeDialog = useCallback(() => {
    setOpen(false);
    setName('');
    setKeyHex('');
    setPrivateChannel(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (!saving) closeDialog();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, saving, closeDialog]);

  async function handleAdd(): Promise<void> {
    if (!valid || saving || disabled) return;

    const existing = configuredChannels.find((channel) => {
      if (channel.name !== normalizedName) return false;
      if (!privateChannel) return true;
      const secret = channels.find((candidate) => candidate.index === channel.index)?.secret;
      return secret != null && bytesToHex(secret) === normalizedKeyHex;
    });
    if (existing) {
      onSelectChannel(existing.index);
      closeDialog();
      return;
    }

    const index = findFirstFreeMeshcoreChannelIndex(channels);
    if (index == null) {
      addToast(t('qrIngest.meshcoreChannelNoFreeIndex'), 'error');
      return;
    }

    setSaving(true);
    try {
      const secretHex = privateChannel
        ? normalizedKeyHex
        : await meshcoreDeriveChannelKeyHexFromName(normalizedName);
      await onSetChannel(index, normalizedName, hexToBytesExactOrThrow(secretHex, 16));
      addToast(t('radioPanel.channelSavedStatus', { index }), 'success');
      onSelectChannel(index);
      closeDialog();
    } catch (error) {
      const message = errLikeToLogString(error);
      console.warn('[MeshcoreChatChannelManager] add failed ' + message);
      addToast(t('radioPanel.channelSaveFailed', { message }), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        disabled={disabled}
        aria-label={t('radioPanel.meshcoreChannel.addButton')}
        title={t('radioPanel.meshcoreChannel.addButton')}
        className="text-muted hover:border-brand-green hover:text-bright-green border-ink-600 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus aria-hidden className="h-4 w-4" size={16} />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="meshcore-chat-channel-title"
            className="bg-secondary-dark rounded-modal shadow-level-3 border-ink-600 w-full max-w-md space-y-4 border p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="meshcore-chat-channel-title" className="text-base font-semibold text-white">
                {t('radioPanel.meshcoreChannel.addTitle')}
              </h2>
              <button
                type="button"
                onClick={() => {
                  closeDialog();
                }}
                disabled={saving}
                aria-label={t('common.close')}
                className="text-muted hover:bg-ink-700 rounded p-1 hover:text-white"
              >
                <X aria-hidden className="h-4 w-4" size={16} />
              </button>
            </div>

            {configuredChannels.length > 0 ? (
              <div className="flex flex-wrap gap-2" aria-label={t('chatPanel.channels')}>
                {configuredChannels.map((channel) => (
                  <span key={channel.index} className="inline-flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={saving}
                      aria-label={channel.name}
                      onClick={() => {
                        onSelectChannel(channel.index);
                        closeDialog();
                      }}
                      className="bg-deep-black text-muted hover:border-brand-green border-ink-700 hover:text-ink-100 rounded-full border px-2.5 py-1 text-xs"
                    >
                      {channel.name}
                    </button>
                    {onRemoveChannel && channel.index !== MESHCORE_PUBLIC_CHANNEL_INDEX ? (
                      <button
                        type="button"
                        disabled={saving || disabled}
                        aria-label={t('chatPanel.removeChannelAria', { name: channel.name })}
                        title={t('chatPanel.removeChannelAria', { name: channel.name })}
                        onClick={() => {
                          closeDialog();
                          onRemoveChannel(channel);
                        }}
                        className="text-muted flex h-6 w-6 items-center justify-center rounded hover:bg-red-400/10 hover:text-red-400"
                      >
                        <X aria-hidden className="h-3.5 w-3.5" size={14} />
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted text-xs">{t('radioPanel.noChannels')}</p>
            )}

            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleAdd();
              }}
            >
              <label className="text-muted flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={privateChannel}
                  onChange={(event) => {
                    setPrivateChannel(event.target.checked);
                    setKeyHex('');
                  }}
                  disabled={saving || disabled}
                  aria-label={t('radioPanel.meshcoreChannel.privateChannel')}
                />
                {t('radioPanel.meshcoreChannel.privateChannel')}
              </label>
              <label htmlFor="meshcore-chat-channel-name" className="text-muted block text-xs">
                {t('radioPanel.meshcoreChannelNameLabel')}
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  id="meshcore-chat-channel-name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  maxLength={
                    privateChannel
                      ? undefined
                      : name.trimStart().startsWith('#')
                        ? MESHCORE_CHANNEL_NAME_MAX_LEN
                        : MESHCORE_CHANNEL_NAME_MAX_LEN - 1
                  }
                  placeholder={privateChannel ? undefined : '#channel'}
                  aria-label={t('radioPanel.meshcoreChannelNameLabel')}
                  disabled={saving || disabled}
                  className={`${INPUT_BOX_CLASS} min-w-0 flex-1`}
                />
                <button
                  type="submit"
                  disabled={!valid || saving || disabled}
                  aria-label={saving ? t('common.saving') : t('common.save')}
                  className="bg-brand-green hover:bg-brand-green/90 text-app-bg disabled:bg-ink-600 disabled:text-ink-400 rounded px-3 py-2 text-xs font-medium disabled:cursor-not-allowed"
                >
                  {saving ? t('common.saving') : t('common.save')}
                </button>
              </div>
              {privateChannel ? (
                <div className="space-y-2">
                  <label htmlFor="meshcore-chat-channel-key" className="text-muted block text-xs">
                    {t('radioPanel.meshcoreChannelKeyLabel')}
                  </label>
                  <input
                    id="meshcore-chat-channel-key"
                    type="password"
                    value={keyHex}
                    onChange={(event) => {
                      setKeyHex(event.target.value);
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={saving || disabled}
                    aria-label={t('radioPanel.meshcoreChannelKeyLabel')}
                    aria-describedby="meshcore-chat-channel-key-hint"
                    aria-invalid={keyHex.length > 0 && !validKey}
                    className={`${INPUT_BOX_CLASS} w-full font-mono`}
                  />
                  <p id="meshcore-chat-channel-key-hint" className="text-muted text-xs">
                    {t('radioPanel.meshcoreChannel.privateKeyHint')}
                  </p>
                </div>
              ) : (
                <p className="text-muted text-xs">{t('radioPanel.meshcoreSha256KeyTitle')}</p>
              )}
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
