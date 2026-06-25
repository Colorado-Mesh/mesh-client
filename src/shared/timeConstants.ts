/** Time duration constants in milliseconds (main + renderer). */
export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;

/**
 * Compact chat: merged consecutive bubbles from the same sender show a muted timestamp when the gap
 * from the previous message is at least this long (same calendar day; day separators still break groups).
 */
export const CHAT_COMPACT_CONTINUATION_TIME_GAP_MS = 5 * MS_PER_MINUTE;

export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Non-leap year (365 days). Coarse duration only; not for calendar-accurate multi-year intervals. */
export const MS_PER_YEAR = 365 * MS_PER_DAY;
