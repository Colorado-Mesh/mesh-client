import { useTranslation } from 'react-i18next';

import { MeshHubMark } from './MeshHubMark';

const COMMUNITY_LINKS = [
  {
    href: 'https://github.com/charlottemeshtastic/mesh-client',
    labelKey: 'common.github',
    titleKey: 'app.footerGithubTitle',
  },
] as const;

/**
 * App panel "About" block. Holds the community tagline and links that used to live in the footer,
 * and the brand mark that used to live in the header (the v6 shell has neither).
 */
export function AppAboutSection() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="app-about-heading" className="mt-8 space-y-3">
      <h3 id="app-about-heading" className="text-muted text-sm font-medium">
        {t('appPanel.aboutSection')}
      </h3>
      <div className="flex items-center gap-4">
        <div className="border-ink-800 flex shrink-0 items-center justify-center rounded-lg border p-2">
          <MeshHubMark />
        </div>
        <div className="min-w-0 space-y-1 text-sm">
          <p className="text-ink-200 font-semibold">{t('app.brandName')}</p>
          <p className="text-muted">
            {t('app.footerSlogan')}{' '}
            <span className="inline-flex flex-wrap gap-x-3">
              {COMMUNITY_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  title={t(link.titleKey)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink-300 decoration-ink-600 hover:text-ink-100 underline underline-offset-2 transition-colors"
                >
                  {t(link.labelKey)}
                </a>
              ))}
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
