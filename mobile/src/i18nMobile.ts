/**
 * Mobile-only strings live in this package (`src/locales/<lng>.json`) instead of the desktop
 * locale files. They are deep-merged into the app's i18next `translation` namespace for every
 * language bundle that gets loaded (the renderer loads non-English bundles on demand, and a later
 * load must not drop the mobile keys). They never overwrite a desktop key.
 *
 * The one exception is `src/locales/desktop-overrides/<lng>.json`: a short, reviewed list of
 * desktop strings a phone user reaches that say "this computer" (Saved locations, the Reticulum
 * first-run screens, the clear-channel confirmation, the share-location help). Those are written
 * over the desktop wording in the mobile apps only. A language without a key keeps its desktop
 * sentence. `pnpm -C mobile run audit` pins the English desktop text of each key, so a desktop
 * copy change asks for the override to be reviewed.
 */
import type { i18n as I18n } from 'i18next';

const bundles = import.meta.glob<Record<string, unknown>>('./locales/*.json', {
  eager: true,
  import: 'default',
});

const overrideBundles = import.meta.glob<Record<string, unknown>>(
  './locales/desktop-overrides/*.json',
  { eager: true, import: 'default' },
);

function byLanguage(
  files: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(files).map(([file, data]) => [file.replace(/^.*\/(.+)\.json$/, '$1'), data]),
  );
}

/** Language code → mobile strings. */
export const MOBILE_LOCALES = byLanguage(bundles);

/** Language code → desktop strings the mobile apps word for a phone (written over desktop's). */
export const MOBILE_DESKTOP_OVERRIDES = byLanguage(overrideBundles);

export function installMobileI18n(i18n: I18n): void {
  let applying = false;
  const apply = (lng: string) => {
    const strings = MOBILE_LOCALES[lng];
    const overrides = MOBILE_DESKTOP_OVERRIDES[lng];
    if ((!strings && !overrides) || applying) return;
    applying = true;
    try {
      // deep merge, never overwrite desktop keys
      if (strings) i18n.addResourceBundle(lng, 'translation', strings, true, false);
      // The reviewed overrides do overwrite, and are applied again whenever the desktop adds a
      // bundle for the language (localeResources.ts adds with overwrite on).
      if (overrides) i18n.addResourceBundle(lng, 'translation', overrides, true, true);
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
