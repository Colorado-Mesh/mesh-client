import { useTranslation } from 'react-i18next';

import { useIncidentStore } from '@/renderer/stores/incidentStore';

export function ResolveIncidentButton({
  incidentId,
  senderName,
}: {
  incidentId: string;
  senderName: string;
}) {
  const { t } = useTranslation();
  const resolveIncident = useIncidentStore((s) => s.resolveIncident);
  return (
    <button
      type="button"
      aria-label={t('incidentPanel.resolveAria', { sender: senderName })}
      onClick={() => {
        resolveIncident(incidentId);
      }}
      className="rounded bg-slate-700 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-600"
    >
      {t('incidentPanel.resolve')}
    </button>
  );
}
