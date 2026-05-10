const NOTIFY_BODY_MAX = 400;

export type MenuUpdateSettledKind = 'upToDate' | 'available' | 'error';

/** Minimal translator for OS notification strings (i18next-compatible). */
export type UpdateMenuNotifyTranslate = (key: string, options?: { version?: string }) => string;

/** Build OS notification copy when the user checked for updates from the app menu. */
export function titlesForMenuUpdateSettled(
  kind: MenuUpdateSettledKind,
  t: UpdateMenuNotifyTranslate,
  extras?: { version?: string; message?: string },
): { title: string; body: string } {
  switch (kind) {
    case 'upToDate':
      return {
        title: t('updateStatus.menuToastUpToDateTitle'),
        body: t('updateStatus.menuToastUpToDateBody'),
      };
    case 'available':
      return {
        title: t('updateStatus.menuToastAvailableTitle'),
        body: t('updateStatus.menuToastAvailableBody', { version: extras?.version ?? '' }),
      };
    case 'error': {
      const raw = (extras?.message ?? '').trim();
      const body =
        raw.length > NOTIFY_BODY_MAX
          ? `${raw.slice(0, NOTIFY_BODY_MAX - 3)}...`
          : raw || t('updateStatus.updateError');
      return {
        title: t('updateStatus.menuToastErrorTitle'),
        body,
      };
    }
  }
}
