/** Protocol switcher unread count — pulse on aria-hidden layer; text span stays fully opaque for contrast. */
export function ProtocolUnreadBadge({
  count,
  fillClass,
}: {
  count: number | string;
  fillClass: string;
}) {
  const label = typeof count === 'number' && count > 99 ? '99+' : count;
  return (
    <span className="relative ml-1.5 inline-flex h-4 min-w-[1.1rem] items-center justify-center">
      <span
        className={`absolute inset-0 animate-pulse rounded-full ${fillClass}`}
        aria-hidden="true"
      />
      <span
        data-protocol-unread-label
        className={`relative z-[1] inline-flex h-4 min-w-[1.1rem] items-center justify-center rounded-full px-0.5 text-[10px] font-bold text-white ${fillClass}`}
      >
        {label}
      </span>
    </span>
  );
}
