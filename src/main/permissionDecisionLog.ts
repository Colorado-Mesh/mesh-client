import { sanitizeLogMessage } from './sanitize-log-message';

export type PermissionHandlerKind = 'checkHandler' | 'requestHandler';

/**
 * Session permission handler logging. Chromium re-checks `notifications` on every
 * `new Notification`, so grants are logged once per (handler, permission); denials
 * are always logged because they explain missing features.
 */
export class PermissionDecisionLogger {
  private readonly loggedGrants = new Set<string>();

  constructor(
    private readonly sink: (message: string) => void = (message) => {
      console.debug(message);
    },
  ) {}

  log(handler: PermissionHandlerKind, permission: string, granted: boolean): void {
    if (granted) {
      const key = `${handler}:${permission}`;
      if (this.loggedGrants.has(key)) return;
      this.loggedGrants.add(key);
    }
    this.sink(
      `[permissions] ${handler}: ${sanitizeLogMessage(permission)} → ${granted ? 'granted' : 'denied'}`,
    );
  }
}
