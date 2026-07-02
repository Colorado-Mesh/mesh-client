import { useTranslation } from 'react-i18next';

import { ReticulumAnnounceControls } from './ReticulumAnnounceControls';
import { ReticulumPropagationControls } from './ReticulumPropagationControls';

export interface ReticulumAppPanelSectionProps {
  sidecarReady?: boolean;
  disabled?: boolean;
}

export function ReticulumAppPanelSection({
  sidecarReady = false,
  disabled = false,
}: ReticulumAppPanelSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <h3 className="text-muted text-sm font-medium">{t('appPanel.reticulumSection')}</h3>
      <div className="bg-secondary-dark space-y-2 rounded-lg p-4">
        <p className="text-muted text-xs">{t('appPanel.reticulumAnnounceHelp')}</p>
        <ReticulumAnnounceControls disabled={disabled || !sidecarReady} embedded />
        <ReticulumPropagationControls sidecarReady={sidecarReady} disabled={disabled} />
      </div>
    </div>
  );
}
