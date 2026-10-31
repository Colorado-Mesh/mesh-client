import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import {
  computeInstantTooltipPosition,
  type InstantTooltipPosition,
} from '@/renderer/lib/instantTooltipPosition';

import { InstantTooltipBubble } from './InstantTooltipBubble';

function mergeAriaDescribedBy(existing: unknown, id: string): string {
  if (typeof existing === 'string' && existing.trim()) {
    return `${existing} ${id}`;
  }
  return id;
}

function withDescribedBy(child: ReactNode, descriptionId: string): ReactNode {
  if (!isValidElement(child)) return child;
  const el = child as ReactElement<{ 'aria-describedby'?: string }>;
  return cloneElement(el, {
    'aria-describedby': mergeAriaDescribedBy(el.props['aria-describedby'], descriptionId),
  });
}

export function HelpTooltip({
  text,
  children,
  className,
  ariaLabel,
  /** When true, wrapper is not focusable (use when children are buttons/links). */
  nonFocusableWrapper = false,
}: {
  text: string;
  children?: ReactNode;
  /** Extra classes on the wrapper (e.g. `shrink-0` in toolbars). */
  className?: string;
  /** Accessible name when custom children replace the default ⓘ trigger. */
  ariaLabel?: string;
  nonFocusableWrapper?: boolean;
}) {
  const [pos, setPos] = useState<InstantTooltipPosition | null>(null);
  const ref = useRef<HTMLElement | null>(null);
  const setRef = (node: HTMLElement | null) => {
    ref.current = node;
  };
  const descriptionId = useId();
  const bubbleId = useId();
  const updatePosition = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos(computeInstantTooltipPosition(r));
  };
  const showHandlers = {
    onMouseEnter: updatePosition,
    onMouseLeave: () => {
      setPos(null);
    },
    onFocus: updatePosition,
    onBlur: () => {
      setPos(null);
    },
  } as const;

  const hiddenDescription = (
    <span id={descriptionId} className="sr-only">
      {text}
    </span>
  );
  const visualBubble =
    pos &&
    createPortal(<InstantTooltipBubble id={bubbleId} text={text} pos={pos} />, document.body);

  // Default ⓘ trigger: semantic button so aria-label / aria-describedby are reliable.
  if (!nonFocusableWrapper && children == null) {
    return (
      <>
        <button
          ref={setRef}
          type="button"
          data-instant-tooltip-managed=""
          className={['inline-flex cursor-help', className].filter(Boolean).join(' ')}
          aria-label={ariaLabel ?? text}
          aria-describedby={descriptionId}
          {...showHandlers}
        >
          <span className="text-muted text-xs select-none" aria-hidden="true">
            ⓘ
          </span>
          {hiddenDescription}
        </button>
        {visualBubble}
      </>
    );
  }

  const content = nonFocusableWrapper ? withDescribedBy(children, descriptionId) : children;

  return (
    <span
      ref={setRef}
      data-instant-tooltip-managed=""
      className={['inline-flex', !nonFocusableWrapper && 'cursor-help', className]
        .filter(Boolean)
        .join(' ')}
      aria-label={ariaLabel}
      aria-describedby={descriptionId}
      tabIndex={nonFocusableWrapper ? undefined : 0}
      {...showHandlers}
    >
      {content}
      {hiddenDescription}
      {visualBubble}
    </span>
  );
}
