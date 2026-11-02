import { useTranslation } from 'react-i18next';

const DEFAULT_CLASS = 'text-muted hover:text-brand-green text-xs transition-colors';

export interface DocsSiteLinkProps {
  href: string;
  /** Defaults to `common.docsLink` ("Docs ↗"). */
  labelKey?: string;
  className?: string;
  'aria-label'?: string;
}

/** External link to a published MkDocs page (`docsSite.ts` URLs). */
export function DocsSiteLink({
  href,
  labelKey = 'common.docsLink',
  className = DEFAULT_CLASS,
  'aria-label': ariaLabel,
}: DocsSiteLinkProps) {
  const { t } = useTranslation();
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className} aria-label={ariaLabel}>
      {t(labelKey)}
    </a>
  );
}
