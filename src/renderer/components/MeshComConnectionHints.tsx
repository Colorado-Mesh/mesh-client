import { useTranslation } from 'react-i18next';

import { NOTICE_CLASS } from './ui/formClasses';

/**
 * Persistent MeshCom Connection-panel ham-license / Country Setting hint.
 * Mount only when the active protocol is MeshCom.
 */
export function MeshComConnectionHints() {
  const { t } = useTranslation();
  return (
    <div className={NOTICE_CLASS.info} role="note">
      <p>{t('meshcom.connectionHint')}</p>
    </div>
  );
}
