import { useTranslation } from 'react-i18next';

export function ConfigApplyNotice() {
  const { t } = useTranslation();

  return (
    <div className="bg-deep-black/50 text-muted space-y-0.5 rounded-lg border border-gray-700/60 px-3 py-2 text-xs">
      <p>{t('configApplyNotice.persistNote')}</p>
      <p>{t('configApplyNotice.restartNote')}</p>
    </div>
  );
}
