import { Check, CircleAlert, Copy } from 'lucide-react-motion';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { writeClipboardText } from '@/renderer/lib/writeClipboardText';

import { type ButtonSize, IconButton } from './Button';

const RESULT_RESET_MS = 1500;

type CopyResult = 'idle' | 'copied' | 'failed';

export interface CopyButtonProps {
  /** Text to copy, or a function that builds it when the button is pressed. */
  text: string | (() => string);
  /** Accessible name, e.g. "Copy route". */
  label: string;
  size?: ButtonSize;
  variant?: 'ghost' | 'secondary';
  className?: string;
}

/**
 * Icon button that copies text through the app clipboard (`writeClipboardText`), shows a check
 * for a moment when it worked or an alert when it did not, and announces either to screen readers.
 */
export function CopyButton({
  text,
  label,
  size = 'md',
  variant = 'ghost',
  className,
}: CopyButtonProps) {
  const { t } = useTranslation();
  const [result, setResult] = useState<CopyResult>('idle');
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );

  const showResult = (next: CopyResult) => {
    setResult(next);
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => {
      setResult('idle');
    }, RESULT_RESET_MS);
  };

  const handleCopy = () => {
    const value = typeof text === 'function' ? text() : text;
    writeClipboardText(value)
      .then(() => {
        showResult('copied');
      })
      .catch((e: unknown) => {
        console.warn('[CopyButton] copy failed ' + errLikeToLogString(e));
        showResult('failed');
      });
  };

  const icon =
    result === 'copied' ? (
      <Check aria-hidden className={`${ICON_MD} text-bright-green`} size={16} />
    ) : result === 'failed' ? (
      <CircleAlert aria-hidden className={`${ICON_MD} text-red-400`} size={16} />
    ) : (
      <Copy aria-hidden className={ICON_MD} size={16} />
    );

  return (
    <>
      <IconButton
        aria-label={label}
        size={size}
        variant={variant}
        className={className}
        onClick={handleCopy}
        icon={icon}
      />
      <span role="status" aria-live="polite" className="sr-only">
        {result === 'copied'
          ? t('common.copied')
          : result === 'failed'
            ? t('common.copyFailed')
            : ''}
      </span>
    </>
  );
}
