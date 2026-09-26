import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

/**
 * Buttons from the v6 style guide (`docs/style-guide.md`, Controls). One primary per view; danger
 * is an outline sized to its label, never a full-width red bar.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

const BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center rounded-lg border font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green disabled:cursor-not-allowed disabled:opacity-50';

export const BUTTON_VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-brand-green text-app-bg hover:bg-brand-green/90',
  secondary:
    'border-secondary-dark bg-sidebar-active-bg text-slate-200 hover:bg-secondary-dark disabled:hover:bg-sidebar-active-bg',
  danger:
    'border-red-400/45 bg-transparent text-red-400 hover:bg-red-400/10 disabled:hover:bg-transparent',
  ghost:
    'border-transparent bg-transparent text-slate-300 hover:bg-sidebar-active-bg hover:text-slate-100',
};

export const BUTTON_SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-7.5 gap-1.5 px-3 text-control',
  md: 'h-8 gap-1.5 px-3.5 text-body',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (aria-hidden, 14 to 16px). */
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function buttonClassName(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  extra?: string,
): string {
  return [BUTTON_BASE, BUTTON_VARIANT_CLASS[variant], BUTTON_SIZE_CLASS[size], extra]
    .filter(Boolean)
    .join(' ');
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}

      type={type}
      className={buttonClassName(variant, size, className)}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required: icon-only controls need an accessible name. */
  'aria-label': string;
  icon: ReactNode;
  /** `ghost` (default) is borderless; `secondary` matches toolbar buttons. */
  variant?: 'ghost' | 'secondary' | 'danger';
  size?: ButtonSize;
  /**
   * Toggled-on look for toolbar toggles (pair with `aria-pressed`): `brand` for an active view,
   * `warn` for a state worth noticing (muted). Replaces the variant colors.
   */
  active?: 'brand' | 'warn' | false;
  ref?: Ref<HTMLButtonElement>;
}

const ICON_BUTTON_ACTIVE: Record<'brand' | 'warn', string> = {
  brand: 'border-transparent bg-sidebar-active-bg text-bright-green',
  warn: 'border-transparent bg-transparent text-amber-400 hover:bg-sidebar-active-bg',
};

const ICON_BUTTON_SIZE: Record<ButtonSize, string> = { sm: 'h-7.5 w-7.5', md: 'h-8 w-8' };

const ICON_BUTTON_VARIANT: Record<NonNullable<IconButtonProps['variant']>, string> = {
  ghost:
    'border-transparent bg-transparent text-muted hover:bg-sidebar-active-bg hover:text-slate-200',
  secondary:
    'border-secondary-dark bg-sidebar-active-bg text-slate-300 hover:bg-secondary-dark hover:text-slate-100',
  danger: 'border-transparent bg-transparent text-red-400 hover:bg-red-400/10',
};

export function IconButton({
  icon,
  variant = 'ghost',
  size = 'md',
  active = false,
  className,
  title,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <button
      ref={ref}

      type={type}
      title={title ?? rest['aria-label']}
      className={[
        'focus-visible:outline-brand-green inline-flex shrink-0 items-center justify-center rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        ICON_BUTTON_SIZE[size],
        active ? ICON_BUTTON_ACTIVE[active] : ICON_BUTTON_VARIANT[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {icon}
    </button>
  );
}
