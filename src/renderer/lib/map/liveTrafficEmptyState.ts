/** i18n keys for the local Live traffic empty overlay and packet feed. */
export interface LiveTrafficLocalEmptyCopy {
  waiting: 'liveTraffic.waiting' | 'liveTraffic.waitingQuiet';
  waitingHint: 'liveTraffic.waitingHint' | 'liveTraffic.waitingHintQuiet';
  emptyFeed: 'liveTraffic.emptyFeed' | 'liveTraffic.emptyFeedQuiet';
}

/**
 * Local Live traffic only shows the last minute of the shared packet log.
 * When the log has older captures, say so instead of implying the radio is missing.
 */
export function liveTrafficLocalEmptyCopy(localPacketLogCount: number): LiveTrafficLocalEmptyCopy {
  if (localPacketLogCount > 0) {
    return {
      waiting: 'liveTraffic.waitingQuiet',
      waitingHint: 'liveTraffic.waitingHintQuiet',
      emptyFeed: 'liveTraffic.emptyFeedQuiet',
    };
  }
  return {
    waiting: 'liveTraffic.waiting',
    waitingHint: 'liveTraffic.waitingHint',
    emptyFeed: 'liveTraffic.emptyFeed',
  };
}
