import type { ReactNode, Ref, ToggleEvent } from 'react';
import { forwardRef, useId, useLayoutEffect, useRef } from 'react';

import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';

const STATIC_CARD_CLASS = 'bg-deep-black border-ink-800 rounded-xl border p-4';

const COLLAPSIBLE_DEFAULT_CLASS = 'group bg-deep-black border-secondary-dark rounded-lg border';
const COLLAPSIBLE_DANGER_CLASS = 'group rounded-lg border border-red-900 bg-red-950/20';

const SUMMARY_DEFAULT_CLASS =
  'text-muted hover:bg-ink-800/40 flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden';
const SUMMARY_DANGER_CLASS =
  'flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm font-medium text-red-300 hover:bg-red-950/40 [&::-webkit-details-marker]:hidden';

const BODY_DEFAULT_CLASS = 'border-ink-700 space-y-3 border-t px-4 pt-3 pb-4';
const BODY_DANGER_CLASS = 'space-y-4 border-t border-red-900/50 px-4 pt-3 pb-4';

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

export interface SettingsSectionProps {
  title: ReactNode;
  /** Muted line under the title, outside the card. */
  description?: ReactNode;
  children: ReactNode;
  /** Extra control beside the title (e.g. HelpTooltip). */
  titleExtra?: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Settings-search anchor on the filled card. Prefer anchoring individual rows instead. */
  anchorId?: string;
}

/** Static settings block: muted title outside a filled card (style-guide settings sections). */
export function SettingsSection({
  title,
  description,
  children,
  titleExtra,
  className,
  bodyClassName,
  anchorId,
}: SettingsSectionProps) {
  const titleId = useId();
  return (
    <section className={`space-y-2 ${className ?? ''}`} aria-labelledby={titleId}>
      <div className="flex items-center gap-1">
        <h3 id={titleId} className="text-muted text-sm font-medium">
          {title}
        </h3>
        {titleExtra}
      </div>
      {description != null && <p className="text-muted text-xs">{description}</p>}
      <div
        data-setting-anchor={anchorId}
        className={`${STATIC_CARD_CLASS}${bodyClassName ? ` ${bodyClassName}` : ''}`}
      >
        {children}
      </div>
    </section>
  );
}

export interface SettingsCollapsibleProps {
  title: ReactNode;
  /** Muted description inside the open body (above children). */
  description?: ReactNode;
  children: ReactNode;
  /** Initial open state for the uncontrolled `<details>`; default collapsed. */
  defaultOpen?: boolean;
  variant?: 'default' | 'danger';
  /** Settings-search anchor on the `<details>` element. */
  anchorId?: string;
  className?: string;
  bodyClassName?: string;
  /** Extra control in the summary row (e.g. HelpTooltip). */
  summaryExtra?: ReactNode;
  onToggle?: (open: boolean) => void;
  /** Heading element for the summary title. */
  titleAs?: 'h3' | 'h4' | 'span';
}

/**
 * Collapsed-by-default settings section. Must remain an uncontrolled native `<details>` so
 * `revealSettingAnchor` and programmatic `ref.current.open = true` keep working.
 */
export const SettingsCollapsible = forwardRef<HTMLDetailsElement, SettingsCollapsibleProps>(
  function SettingsCollapsible(
    {
      title,
      description,
      children,
      defaultOpen = false,
      variant = 'default',
      anchorId,
      className,
      bodyClassName,
      summaryExtra,
      onToggle,
      titleAs = 'h3',
    },
    ref,
  ) {
    const TitleTag = titleAs;
    const isDanger = variant === 'danger';
    const localRef = useRef<HTMLDetailsElement>(null);

    useLayoutEffect(() => {
      const el = localRef.current;
      if (el && defaultOpen) el.open = true;
    }, [defaultOpen]);

    const handleToggle = (event: ToggleEvent<HTMLDetailsElement>) => {
      onToggle?.(event.currentTarget.open);
    };

    return (
      <details
        ref={(node) => {
          localRef.current = node;
          assignRef(ref, node);
        }}
        data-setting-anchor={anchorId}
        className={`${isDanger ? COLLAPSIBLE_DANGER_CLASS : COLLAPSIBLE_DEFAULT_CLASS}${className ? ` ${className}` : ''}`}
        onToggle={onToggle ? handleToggle : undefined}
      >
        <summary className={isDanger ? SUMMARY_DANGER_CLASS : SUMMARY_DEFAULT_CLASS}>
          <span className="flex min-w-0 items-center gap-1">
            <TitleTag>{title}</TitleTag>
            {summaryExtra != null && (
              // Stop HelpTooltip clicks from toggling the section.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- swallow summary activation only
              <span
                className="inline-flex"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                {summaryExtra}
              </span>
            )}
          </span>
          <DetailsChevron
            className={`h-4 w-4 shrink-0 transition-transform group-open:rotate-180 ${isDanger ? 'text-red-400' : 'text-muted'}`}
          />
        </summary>
        <div
          className={`${isDanger ? BODY_DANGER_CLASS : BODY_DEFAULT_CLASS}${bodyClassName ? ` ${bodyClassName}` : ''}`}
        >
          {description != null && <p className="text-muted text-xs">{description}</p>}
          {children}
        </div>
      </details>
    );
  },
);
