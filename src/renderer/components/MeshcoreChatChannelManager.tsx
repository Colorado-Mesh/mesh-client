import { Plus, X } from 'lucide-react-motion';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  findFirstFreeMeshcoreChannelIndex,
  isValidMeshcoreHashtagChannelName,
  normalizeMeshcoreHashtagChannelName,
} from '@/renderer/lib/meshcoreChatChannelAdd';
import { meshcoreConfiguredChatChannels } from '@/renderer/lib/meshcoreConfiguredChatChannels';
import {
  MESHCORE_CHANNEL_NAME_MAX_LEN,
  meshcoreDeriveChannelKeyHexFromName,
} from '@/renderer/lib/meshcoreUtils';
import { hexToBytesExactOrThrow } from '@/shared/hexBytes';

import { useToast } from './Toast';

interface Props {
  channels: readonly { index: number; name: string; secret?: Uint8Array }[];
  disabled: boolean;
  onSetChannel: (index: number, name: string, secret: Uint8Array) => Promise<void>;
  onSelectChannel: (index: number) => void;
}

export default function MeshcoreChatChannelManager({
  channels,
  disabled,
  onSetChannel,
  onSelectChannel,
}: Props) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedName = normalizeMeshcoreHashtagChannelName(name);
  const validName = isValidMeshcoreHashtagChannelName(name);
  const configuredChannels = meshcoreConfiguredChatChannels(channels);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function handleAdd(): Promise<void> {
    if (!validName || saving || disabled) return;

    const existing = configuredChannels.find((channel) => channel.name === normalizedName);
    if (existing) {
      onSelectChannel(existing.index);
      setOpen(false);
      setName('');
      return;
    }

    const index = findFirstFreeMeshcoreChannelIndex(channels);
    if (index == null) {
      addToast(t('qrIngest.meshcoreChannelNoFreeIndex'), 'error');
      return;
    }

    setSaving(true);
    try {
      const secretHex = await meshcoreDeriveChannelKeyHexFromName(normalizedName);
      await onSetChannel(index, normalizedName, hexToBytesExactOrThrow(secretHex, 16));
      addToast(t('radioPanel.channelSavedStatus', { index }), 'success');
      onSelectChannel(index);
      setOpen(false);
      setName('');
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
        className="text-muted hover:border-brand-green hover:text-bright-green inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-gray-600 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus aria-hidden className="h-4 w-4" size={16} />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="meshcore-chat-channel-title"
            className="bg-secondary-dark w-full max-w-md space-y-4 rounded-xl border border-gray-600 p-4 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="meshcore-chat-channel-title" className="text-base font-semibold text-white">
                {t('radioPanel.meshcoreChannel.addTitle')}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                }}
                aria-label={t('common.close')}
                className="text-muted rounded p-1 hover:bg-gray-700 hover:text-white"
              >
                <X aria-hidden className="h-4 w-4" size={16} />
              </button>
            </div>

            {configuredChannels.length > 0 ? (
              <div className="flex flex-wrap gap-2" aria-label={t('chatPanel.channels')}>
                {configuredChannels.map((channel) => (
                  <button
                    type="button"
                    key={channel.index}
                    onClick={() => {
                      onSelectChannel(channel.index);
                      setOpen(false);
                    }}
                    className="bg-deep-black text-muted hover:border-brand-green rounded-full border border-gray-700 px-2.5 py-1 text-xs hover:text-gray-100"
                  >
                    {channel.name}
                  </button>
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
                    name.trimStart().startsWith('#')
                      ? MESHCORE_CHANNEL_NAME_MAX_LEN
                      : MESHCORE_CHANNEL_NAME_MAX_LEN - 1
                  }
                  placeholder="#channel"
                  disabled={saving || disabled}
                  className="bg-deep-black focus:border-brand-green min-w-0 flex-1 rounded border border-gray-600 px-3 py-2 text-sm text-white outline-none disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!validName || saving || disabled}
                  className="bg-readable-green hover:bg-readable-green/90 rounded px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-600 disabled:text-gray-400"
                >
                  {saving ? t('common.saving') : t('common.save')}
                </button>
              </div>
              <p className="text-muted text-xs">{t('radioPanel.meshcoreSha256KeyTitle')}</p>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
