import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useAutoTranslate } from '@/renderer/hooks/useAutoTranslate';
import { useMessageTranslation } from '@/renderer/hooks/useMessageTranslation';

import type { MessageTranslationProps } from './MessageTranslateButton';

export function TranslatedMessageBlock({
  messageKey,
  text,
  incoming = false,
  onContentResize,
}: MessageTranslationProps) {
  const { t, i18n } = useTranslation();
  const translation = useMessageTranslation(messageKey, text);
  const { state } = translation;
  useAutoTranslate(messageKey, text, incoming);
  const resizeRef = useRef(onContentResize);
  useLayoutEffect(() => {
    resizeRef.current = onContentResize;
  }, [onContentResize]);
  useEffect(() => {
    if (state.loading || state.result) resizeRef.current?.();
  }, [state]);
  if (!state.loading && !state.result) return null;
  const result = state.result;
  const buttonClass = 'text-bright-green rounded-control underline underline-offset-2';
  return (
    <div className="border-ink-700 mt-2 border-t pt-2 text-sm" aria-live="polite">
      {state.loading ? (
        <p className="text-muted">{t('chatTranslation.loading')}</p>
      ) : result?.ok ? (
        <>
          {state.showTranslation && (
            <p className="text-ink-100 break-words whitespace-pre-wrap">{result.text}</p>
          )}
          <p className="text-muted mt-1 text-xs">
            {t('chatTranslation.attribution', {
              language:
                result.detectedLang === 'auto'
                  ? t('chatTranslation.detectedLanguage')
                  : (new Intl.DisplayNames([i18n.language], { type: 'language' }).of(
                      result.detectedLang,
                    ) ?? result.detectedLang),
              provider: result.provider === 'offline' ? 'Bergamot' : 'LibreTranslate',
            })}
            {' · '}
            <button
              type="button"
              className={buttonClass}
              aria-label={t(
                state.showTranslation
                  ? 'chatTranslation.showOriginal'
                  : 'chatTranslation.showTranslation',
              )}
              onClick={translation.toggle}
            >
              {t(
                state.showTranslation
                  ? 'chatTranslation.showOriginal'
                  : 'chatTranslation.showTranslation',
              )}
            </button>
          </p>
        </>
      ) : (
        <>
          <p className="text-orange-300">
            {t(
              result?.reason === 'uncertain'
                ? 'chatTranslation.uncertain'
                : result?.reason === 'unsupported'
                  ? 'chatTranslation.unsupported'
                  : result?.reason === 'missingPack'
                    ? 'chatTranslation.missingPack'
                    : 'chatTranslation.error',
            )}
          </p>
          {result?.reason === 'missingPack' && (
            <button
              type="button"
              className={buttonClass}
              aria-label={t('chatTranslation.downloadPacks')}
              onClick={translation.openSettings}
            >
              {t('chatTranslation.downloadPacks')}
              {result.missingPacks?.length ? ` (${result.missingPacks.join(', ')})` : ''}
            </button>
          )}
          {translation.libreEnabled && (
            <button
              type="button"
              className={`${buttonClass} ml-3`}
              aria-label={t('chatTranslation.online')}
              onClick={() => {
                void translation.translate('libre');
              }}
            >
              {t('chatTranslation.online')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
