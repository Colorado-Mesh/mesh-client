import { useEffect } from 'react';

import type { UpdateState } from '../App';

interface Props {
  updateState: UpdateState;
  onDownload: () => void;
  onInstall: () => void;
  onViewRelease: () => void;
  onDismiss: () => void;
}

function IconUpToDate() {
  return (
    <svg
      className="w-5 h-5 text-brand-green shrink-0"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function IconUpdateAvailable() {
  return (
    <svg
      className="w-5 h-5 text-brand-green shrink-0"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  );
}

export default function UpdateBanner({
  updateState,
  onDownload,
  onInstall,
  onViewRelease,
  onDismiss,
}: Props) {
  useEffect(() => {
    if (updateState.phase !== 'up-to-date') return;
    const t = setTimeout(() => onDismiss(), 3000);
    return () => clearTimeout(t);
  }, [updateState.phase, onDismiss]);

  if (updateState.phase === 'idle' || updateState.dismissed) return null;

  const { phase, version, isPackaged, isMac } = updateState;

  // On macOS or in dev mode, always direct to the releases page (no auto-install)
  const useReleasePage = !isPackaged || isMac;

  const rootClass =
    phase === 'up-to-date'
      ? 'flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 border-b border-brand-green/30 text-sm'
      : phase === 'available'
        ? 'relative flex items-center justify-center min-h-[2.25rem] px-4 py-2 pr-24 bg-gray-900 border-b border-brand-green/30 text-sm'
        : 'flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-brand-green/30 text-sm';

  const dismissClass =
    phase === 'available'
      ? 'absolute right-4 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300 transition-colors text-xs font-medium px-2 py-1 rounded border border-gray-700 hover:border-gray-600'
      : 'ml-auto text-gray-600 hover:text-gray-300 transition-colors text-xs font-medium px-2 py-1 rounded border border-gray-700 hover:border-gray-600';

  return (
    <div role="status" aria-live="polite" className={rootClass}>
      {phase === 'up-to-date' && (
        <>
          <IconUpToDate />
          <span className="text-brand-green font-medium">You&apos;re up to date</span>
        </>
      )}

      {phase === 'available' && (
        <div className="flex flex-1 items-center justify-center gap-2 flex-wrap">
          <IconUpdateAvailable />
          <span className="text-brand-green font-medium">Update v{version} available</span>
          {useReleasePage ? (
            <button
              onClick={onViewRelease}
              className="px-3 py-0.5 rounded bg-brand-green/20 text-bright-green border border-brand-green/40 hover:bg-brand-green/30 transition-colors text-xs"
            >
              View Release
            </button>
          ) : (
            <button
              onClick={onDownload}
              className="px-3 py-0.5 rounded bg-brand-green/20 text-bright-green border border-brand-green/40 hover:bg-brand-green/30 transition-colors text-xs"
            >
              Download
            </button>
          )}
        </div>
      )}

      {phase === 'downloading' && (
        <>
          <span className="text-gray-300">Downloading update…</span>
          <div className="flex-1 max-w-[160px] h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-green transition-all duration-300"
              style={{ width: `${updateState.percent ?? 0}%` }}
            />
          </div>
          <span className="text-gray-400 text-xs tabular-nums">{updateState.percent ?? 0}%</span>
        </>
      )}

      {phase === 'ready' && (
        <>
          <span className="text-brand-green font-medium">Ready to install</span>
          <button
            onClick={onInstall}
            className="px-3 py-0.5 rounded bg-brand-green/20 text-bright-green border border-brand-green/40 hover:bg-brand-green/30 transition-colors text-xs"
          >
            Restart Now
          </button>
          <button
            onClick={onDismiss}
            className="text-gray-500 hover:text-gray-300 text-xs transition-colors"
          >
            Later
          </button>
        </>
      )}

      {phase === 'error' && (
        <span className="text-red-400">
          Update check failed — check your network and see the app logs for details
        </span>
      )}

      {/* Dismiss — not shown during active download or the auto-dismissing up-to-date notice */}
      {phase !== 'downloading' && phase !== 'up-to-date' && (
        <button onClick={onDismiss} aria-label="Dismiss" className={dismissClass}>
          Dismiss
        </button>
      )}
    </div>
  );
}
