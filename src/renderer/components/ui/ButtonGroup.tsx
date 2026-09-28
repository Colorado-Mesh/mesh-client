import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Related toolbar actions joined with shared borders (Flood advert / Import / Refresh). */
export function ButtonGroup({
  'aria-label': ariaLabel,
  children,
  className,
}: {
  'aria-label': string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`border-secondary-dark bg-sidebar-active-bg [&>*+*]:border-secondary-dark rounded-control flex shrink-0 overflow-hidden border [&>*+*]:border-l ${className ?? ''}`}
    >
      {children}
    </div>
  );
}

export interface GroupButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
}

export function GroupButton({
  icon,
  children,
  className,
  type = 'button',
  ...rest
}: GroupButtonProps) {
  return (
    <button
      type={type}
      className={`hover:bg-secondary-dark text-body text-ink-200 flex h-7.5 shrink-0 items-center gap-1.5 px-3 font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ''}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
