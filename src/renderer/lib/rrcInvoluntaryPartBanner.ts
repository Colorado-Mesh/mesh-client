/**
 * Resolve the sticky RRC banner i18n key after an involuntary hub PART.
 * Kick/ban wording is reserved for `isRrcModerationLanguage` notice/error paths.
 */

export interface ResolveRrcInvoluntaryPartBannerOpts {
  voluntary: boolean;
  /** Skip while sidecar auto-reconnect is in flight (link drop → rejoin). */
  sessionStatus?: string | null;
}

/**
 * Returns an i18n key for the moderation banner, or `null` when no banner should show
 * (voluntary `/part`, or reconnect already under way).
 */
export function resolveRrcInvoluntaryPartBannerKey(
  opts: ResolveRrcInvoluntaryPartBannerOpts,
): string | null {
  if (opts.voluntary) return null;
  if (opts.sessionStatus === 'reconnecting') return null;
  return 'rrc.moderation.hubParted';
}
