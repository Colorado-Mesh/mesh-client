import { useTranslation } from 'react-i18next';

import type { PathCapability } from '@/shared/remote-types';
import { resolveRemoteReasonI18nKey } from '@/shared/remote-types';

const SPEED_CLASSES: Record<PathCapability['speed'], string> = {
  high: 'border-green-700 bg-green-900/30 text-green-300',
  constrained: 'border-amber-700 bg-amber-900/30 text-amber-300',
  mixed: 'border-amber-700 bg-amber-900/30 text-amber-300',
  unknown: 'border-gray-600 bg-gray-800/50 text-gray-400',
};

export interface RemotePathCapabilityChipProps {
  capability: PathCapability | null;
  loading?: boolean;
}

/** Small chip surfacing rnsh/rncp path-speed gating; soft-warns on constrained/unknown paths. */
export function RemotePathCapabilityChip({
  capability,
  loading,
}: Readonly<RemotePathCapabilityChipProps>) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <span className="rounded-full border border-gray-600 bg-gray-800/50 px-2 py-0.5 text-[11px] text-gray-400">
        {t('reticulumRemote.pathCapability.checking')}
      </span>
    );
  }
  if (!capability) return null;

  const reasonI18nKey = resolveRemoteReasonI18nKey(capability.reason_key);
  const warn = capability.speed === 'constrained' || capability.speed === 'unknown';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${SPEED_CLASSES[capability.speed]}`}
      title={reasonI18nKey ? t(reasonI18nKey) : undefined}
    >
      {t(`reticulumRemote.pathCapability.speed.${capability.speed}`)}
      {capability.hops != null && (
        <span className="text-[10px] opacity-80">
          {t('reticulumRemote.pathCapability.hops', { count: capability.hops })}
        </span>
      )}
      {warn && reasonI18nKey && (
        <span className="text-[10px] opacity-90">· {t(reasonI18nKey)}</span>
      )}
    </span>
  );
}
