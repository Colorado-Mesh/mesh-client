/** Protocol switcher unread count — pulse on aria-hidden layer; text span stays fully opaque for contrast. */
export function ProtocolUnreadBadge({
  count,
  fillClass,
  positionClass = 'relative ml-1.5',
}: {
  count: number | string;
  fillClass: string;
  /** Placement of the badge root; must establish a containing block (relative or absolute). */
  positionClass?: string;
}) {
  const label = typeof count === 'number' && count > 99 ? '99+' : count;
  return (
    <span className={`${positionClass} inline-flex h-4 min-w-[1.1rem] items-center justify-center`}>
      <span
        className={`absolute inset-0 animate-pulse rounded-full ${fillClass}`}
        aria-hidden="true"
      />
      <span
        data-protocol-unread-label
        className={`text-2xs relative z-[1] inline-flex h-4 min-w-[1.1rem] items-center justify-center rounded-full px-0.5 font-semibold text-white ${fillClass}`}
      >
        {label}
      </span>
    </span>
  );
}
