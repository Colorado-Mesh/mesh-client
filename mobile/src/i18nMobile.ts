/**
 * Mobile-only strings live in this package (`src/locales/<lng>.json`) instead of the desktop
 * locale files. They are deep-merged into the app's i18next `translation` namespace for every
 * language bundle that gets loaded (the renderer loads non-English bundles on demand, and a later
 * load must not drop the mobile keys).
 */
import type { i18n as I18n } from 'i18next';

const bundles = import.meta.glob<Record<string, unknown>>('./locales/*.json', {
  eager: true,
  import: 'default',
});

/** Language code → mobile strings. */
export const MOBILE_LOCALES: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(bundles).map(([file, data]) => [file.replace(/^.*\/(.+)\.json$/, '$1'), data]),
);

export function installMobileI18n(i18n: I18n): void {
  let applying = false;
  const apply = (lng: string) => {
    const strings = MOBILE_LOCALES[lng];
    if (!strings || applying) return;
    applying = true;
    try {
      // deep merge, never overwrite desktop keys
      i18n.addResourceBundle(lng, 'translation', strings, true, false);
    } finally {
      applying = false;
    }
  };
  apply('en');
  for (const lng of Object.keys(i18n.store.data)) apply(lng);
  i18n.store.on('added', (lng: string, ns: string) => {
    if (ns === 'translation') apply(lng);
  });
  i18n.on('languageChanged', apply);
}
