import { useTranslation } from 'react-i18next';

import { SpinnerIcon } from '@/renderer/lib/icons/spinnerIcon';
import type { ReticulumLocalInterfaceInput } from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';

export interface ReticulumLocalInterfaceConnectingBlockProps {
  interfaces: readonly ReticulumLocalInterfaceInput[];
}

/** In-progress BLE RNode link after stack start (not an error). */
export function ReticulumLocalInterfaceConnectingBlock({
  interfaces,
}: ReticulumLocalInterfaceConnectingBlockProps) {
  const { t } = useTranslation();

  if (interfaces.length === 0) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-cyan-700/45 bg-cyan-950/40 px-3 py-2.5 text-sm text-cyan-100"
    >
      <div className="flex items-start gap-2">
        <SpinnerIcon className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-cyan-200">
            {t('connectionPanel.reticulumLocalInterfaces.connectingHeading', {
              count: interfaces.length,
            })}
          </p>
          <ul className="mt-2 space-y-1 text-xs text-cyan-100/90">
            {interfaces.map((iface) => (
              <li key={iface.id}>
                {t('connectionPanel.reticulumLocalInterfaces.connectingRow', {
                  name: iface.name,
                })}
              </li>
            ))}
          </ul>
          <p className="text-muted mt-2 text-[11px]">
            {t('connectionPanel.reticulumLocalInterfaces.connectingHintBle')}
          </p>
        </div>
      </div>
    </div>
  );
}
