import type { ReactNode } from 'react';
import { useId } from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  /** Muted second line under the label. */
  description?: ReactNode;
  disabled?: boolean;
}

/** On/off setting row: label left, `role="switch"` toggle right (Option B Connection). */
export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span id={labelId} className="text-body text-ink-200">
          {label}
        </span>
        {description && (
          <span id={descriptionId} className="text-muted text-xs">
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        onClick={() => {
          onChange(!checked);
        }}
        className={`focus-visible:outline-brand-green relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? 'bg-brand-green' : 'bg-secondary-dark'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 h-4 w-4 rounded-full transition-[left] ${
            checked ? 'left-4.5 bg-white' : 'bg-ink-300 left-0.5'
          }`}
        />
      </button>
    </div>
  );
}
