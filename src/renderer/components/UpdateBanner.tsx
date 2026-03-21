import type { UpdateState } from '../App';

interface Props {
  updateState: UpdateState;
  onDownload: () => void;
  onInstall: () => void;
  onViewRelease: () => void;
  onDismiss: () => void;
}

export default function UpdateBanner({
  updateState,
  onDownload,
  onInstall,
  onViewRelease,
  onDismiss,
}: Props) {
  if (updateState.phase === 'idle' || updateState.dismissed) return null;

  const { phase, version, isPackaged, isMac } = updateState;

  // On macOS or in dev mode, always direct to the releases page (no auto-install)
  const useReleasePage = !isPackaged || isMac;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-brand-green/30 text-sm"
    >
      {phase === 'available' && (
        <>
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
        </>
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
        <span className="text-red-400">Update check failed — check your network connection</span>
      )}

      {/* Dismiss — not shown during active download */}
      {phase !== 'downloading' && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="ml-auto text-gray-600 hover:text-gray-300 transition-colors text-xs font-medium px-2 py-1 rounded border border-gray-700 hover:border-gray-600"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
