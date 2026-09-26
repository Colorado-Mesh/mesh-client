import { useTranslation } from 'react-i18next';

import { ColoradoMeshMark } from './ColoradoMeshMark';

const COMMUNITY_LINKS = [
  {
    href: 'https://discord.com/invite/McChKR5NpS',
    labelKey: 'common.discord',
    titleKey: 'app.footerDiscordTitle',
  },
  {
    href: 'https://github.com/Colorado-Mesh/mesh-client',
    labelKey: 'common.github',
    titleKey: 'app.footerGithubTitle',
  },
  {
    href: 'https://coloradomesh.org/',
    labelKey: 'common.website',
    titleKey: 'app.footerWebsiteTitle',
  },
] as const;

interface Props {
  /** Replays the mesh signal pulse (BootSequence) animation. */
  onPlayAnimation: () => void;
}

/**
 * App panel "About" block. Holds the community tagline and links that used to live in the footer,
 * and the brand mark that used to live in the header (the v6 shell has neither).
 */
export function AppAboutSection({ onPlayAnimation }: Props) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="app-about-heading" className="mt-8 space-y-3">
      <h3 id="app-about-heading" className="text-muted text-sm font-medium">
        {t('appPanel.aboutSection')}
      </h3>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onPlayAnimation}
          aria-label={t('aria.playAnimation')}
          title={t('aria.playAnimation')}
          className="hover:bg-sidebar-active-bg flex shrink-0 items-center justify-center rounded-lg border border-slate-800 p-2 transition-colors"
        >
          <ColoradoMeshMark />
        </button>
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-semibold text-slate-200">{t('app.brandName')}</p>
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
                  className="text-slate-300 underline decoration-slate-600 underline-offset-2 transition-colors hover:text-slate-100"
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
