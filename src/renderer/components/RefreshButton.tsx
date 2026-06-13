import { PARENT_HOVER_ATTR, RotateCcw } from 'lucide-react-motion';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import { SpinnerIcon } from '@/renderer/lib/icons/spinnerIcon';

interface RefreshButtonProps {
  onRefresh: () => Promise<void>;
  disabled?: boolean;
  minimumAnimationMs?: number;
}

const HARD_TIMEOUT_MS = 5000; // Never spin longer than 5 seconds

export default function RefreshButton({
  onRefresh,
  disabled,
  minimumAnimationMs = 2500,
}: RefreshButtonProps) {
  const { t } = useTranslation();
  const [spinning, setSpinning] = useState(false);
  const parentTrigger = useParentIconTrigger();

  const handleClick = async () => {
    if (spinning || disabled) return;
    setSpinning(true);
    try {
      console.debug('[RefreshButton] handleClick');
      await Promise.all([
        // Race the actual refresh against a hard timeout — whichever finishes first
        Promise.race([
          onRefresh().catch((err: unknown) => {
            console.debug('[RefreshButton] onRefresh failed ' + errLikeToLogString(err));
          }),
          new Promise<void>((r) => setTimeout(r, HARD_TIMEOUT_MS)),
        ]),
        // Ensure the spinner shows for at least the minimum animation time
        new Promise<void>((r) => setTimeout(r, minimumAnimationMs)),
      ]);
    } catch (e) {
      console.debug('[RefreshButton] handleClick outer ' + errLikeToLogString(e));
    } finally {
      setSpinning(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || spinning}
      title={t('common.refresh')}
      className="rounded-full p-1.5 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
      {...{ [PARENT_HOVER_ATTR]: '' }}
    >
      {spinning ? (
        <SpinnerIcon className="h-5 w-5 text-gray-400" />
      ) : (
        <RotateCcw
          aria-hidden
          className="h-5 w-5 text-gray-400"
          trigger={parentTrigger}
          size={20}
        />
      )}
    </button>
  );
}
