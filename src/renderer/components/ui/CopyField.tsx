import { CopyButton } from './CopyButton';

export interface CopyFieldProps {
  value: string;
  /** Shown instead of `value`, e.g. a shortened key. The full value is still copied. */
  display?: string;
  /** Accessible name of the copy button, e.g. "Copy client key". */
  copyLabel: string;
}

/** Read-only mono value with a copy button (client keys, public keys, addresses). */
export function CopyField({ value, display, copyLabel }: CopyFieldProps) {
  return (
    <div className="flex min-w-0 gap-2">
      <div
        className="bg-app-bg text-control rounded-control border-ink-800 text-ink-300 flex h-8 min-w-0 flex-1 items-center overflow-hidden border px-2.5 font-mono whitespace-nowrap"
        title={value}
      >
        <span className="truncate">{display ?? value}</span>
      </div>
      <CopyButton text={value} label={copyLabel} variant="secondary" />
    </div>
  );
}
