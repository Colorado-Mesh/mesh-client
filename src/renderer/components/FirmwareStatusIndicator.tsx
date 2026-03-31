import type { FirmwareCheckResult } from '../lib/firmwareCheck';

interface Props {
  phase: FirmwareCheckResult['phase'];
  latestVersion?: string;
  onOpenReleases: () => void;
}

function IconSpinner() {
  return (
    <svg
      className="h-3 w-3 shrink-0 animate-spin text-gray-400"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function IconUpToDate() {
  return (
    <svg
      className="text-brand-green h-3 w-3 shrink-0"
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

function IconWarning() {
  return (
    <svg
      className="h-3 w-3 shrink-0 text-amber-500"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function FirmwareStatusIndicator({ phase, latestVersion, onOpenReleases }: Props) {
  if (phase === 'idle' || phase === 'error') return null;

  if (phase === 'checking') {
    return (
      <span role="status" aria-label="Checking firmware version">
        <IconSpinner />
      </span>
    );
  }

  if (phase === 'up-to-date') {
    return (
      <span role="img" aria-label="Firmware is up to date">
        <IconUpToDate />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpenReleases}
      className="font-inherit inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11px] text-amber-400 transition-colors hover:text-amber-300"
      aria-label={
        latestVersion ? `Firmware update available: v${latestVersion}` : 'Firmware update available'
      }
    >
      <IconWarning />
      {latestVersion && <span className="tabular-nums">v{latestVersion}</span>}
    </button>
  );
}
