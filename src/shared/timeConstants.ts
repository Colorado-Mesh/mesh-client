/** Time duration constants in milliseconds (main + renderer). */
export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;

/** GitHub Releases API fetch abort (matches other main-process AbortSignal.timeout usage). */
export const GITHUB_RELEASES_FETCH_TIMEOUT_MS = 10 * MS_PER_SECOND;

/**
 * Compact chat: merged consecutive bubbles from the same sender show a muted timestamp when the gap
 * from the previous message is at least this long (same calendar day; day separators still break groups).
 */
export const CHAT_COMPACT_CONTINUATION_TIME_GAP_MS = 5 * MS_PER_MINUTE;

export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Main-process renderer working-set auto sample cadence (runs whether or not the window is
 * backgrounded). Jittered ±20% by the sampler so machines do not align.
 */
export const RENDERER_MEMORY_AUTO_SAMPLE_INTERVAL_MS = 2 * MS_PER_HOUR;

/** Break Support sparkline segments when consecutive samples are farther apart than this. */
export const RENDERER_MEMORY_CHART_GAP_MS = 2 * RENDERER_MEMORY_AUTO_SAMPLE_INTERVAL_MS;

/** Service announcements feed: fetch abort, first check after launch, and periodic re-check. */
export const SERVICE_ANNOUNCEMENT_FETCH_TIMEOUT_MS = 10 * MS_PER_SECOND;
export const SERVICE_ANNOUNCEMENT_STARTUP_DELAY_MS = 10 * MS_PER_SECOND;
export const SERVICE_ANNOUNCEMENT_CHECK_INTERVAL_MS = 6 * MS_PER_HOUR;

/** Non-leap year (365 days). Coarse duration only; not for calendar-accurate multi-year intervals. */
export const MS_PER_YEAR = 365 * MS_PER_DAY;
