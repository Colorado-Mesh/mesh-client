export interface DisplayTimeOptionsInput {
  /** Include seconds in the time portion. */
  withSeconds?: boolean;
  /**
   * When true, force 24-hour clocks (`hour12: false`).
   * When false/omitted, omit `hour12` so the OS/locale decides.
   */
  use24Hour?: boolean;
}

/** Options for `Date#toLocaleTimeString` / `toLocaleString` honoring the 24h preference. */
export function getDisplayTimeOptions(
  input: DisplayTimeOptionsInput = {},
): Intl.DateTimeFormatOptions {
  const opts: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
  };
  if (input.withSeconds) {
    opts.second = '2-digit';
  }
  if (input.use24Hour === true) {
    opts.hour12 = false;
  }
  return opts;
}

function toDate(ts: number | Date): Date {
  return typeof ts === 'number' ? new Date(ts) : ts;
}

/** Locale wall-clock time (hour + minute; optional seconds). */
export function formatDisplayTime(ts: number | Date, input: DisplayTimeOptionsInput = {}): string {
  return toDate(ts).toLocaleTimeString([], getDisplayTimeOptions(input));
}

/** Locale date + time (for map-style full timestamps). */
export function formatDisplayDateTime(
  ts: number | Date,
  input: Omit<DisplayTimeOptionsInput, 'withSeconds'> = {},
): string {
  const opts: Intl.DateTimeFormatOptions = {};
  if (input.use24Hour === true) {
    opts.hour12 = false;
  }
  return toDate(ts).toLocaleString(undefined, opts);
}
