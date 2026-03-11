import { useState } from 'react';

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
  const [spinning, setSpinning] = useState(false);

  const handleClick = async () => {
    if (spinning || disabled) return;
    setSpinning(true);
    try {
      console.debug('[RefreshButton] handleClick');
      await Promise.all([
        // Race the actual refresh against a hard timeout — whichever finishes first
        Promise.race([
          onRefresh().catch((err) => {
            console.debug('[RefreshButton] onRefresh failed', err);
          }),
          new Promise<void>((r) => setTimeout(r, HARD_TIMEOUT_MS)),
        ]),
        // Ensure the spinner shows for at least the minimum animation time
        new Promise<void>((r) => setTimeout(r, minimumAnimationMs)),
      ]);
    } catch (e) {
      console.debug('[RefreshButton] handleClick outer', e);
    } finally {
      setSpinning(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || spinning}
      title="Refresh"
      className="p-1.5 rounded-full hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      <svg
        className={`w-5 h-5 text-gray-400 ${spinning ? 'animate-spin' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
    </button>
  );
}
