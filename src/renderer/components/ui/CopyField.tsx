import { Check, Copy } from 'lucide-react-motion';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { writeClipboardText } from '@/renderer/lib/writeClipboardText';

import { IconButton } from './Button';

const COPIED_RESET_MS = 1500;

export interface CopyFieldProps {
  value: string;
  /** Shown instead of `value`, e.g. a shortened key. The full value is still copied. */
  display?: string;
  /** Accessible name of the copy button, e.g. "Copy client key". */
  copyLabel: string;
}

/** Read-only mono value with a copy button (client keys, public keys, addresses). */
export function CopyField({ value, display, copyLabel }: CopyFieldProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );

  const handleCopy = () => {
    writeClipboardText(value)
      .then(() => {
        setCopied(true);
        if (resetRef.current) clearTimeout(resetRef.current);
        resetRef.current = setTimeout(() => {
          setCopied(false);
        }, COPIED_RESET_MS);
      })
      .catch((e: unknown) => {
        console.warn('[CopyField] copy failed ' + errLikeToLogString(e));
      });
  };

  return (
    <div className="flex min-w-0 gap-2">
      <div
        className="bg-app-bg flex h-8 min-w-0 flex-1 items-center overflow-hidden rounded-lg border border-slate-800 px-2.5 font-mono text-[12.5px] whitespace-nowrap text-slate-300"
        title={value}
      >
        <span className="truncate">{display ?? value}</span>
      </div>
      <IconButton
        aria-label={copyLabel}
        variant="secondary"
        onClick={handleCopy}
        icon={
          copied ? (
            <Check aria-hidden className={`${ICON_MD} text-bright-green`} size={16} />
          ) : (
            <Copy aria-hidden className={ICON_MD} size={16} />
          )
        }
      />
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? t('common.copied') : ''}
      </span>
    </div>
  );
}
