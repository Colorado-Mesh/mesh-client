import { useTranslation } from 'react-i18next';

import type { ProtocolCapabilities } from '@/renderer/lib/radio/BaseRadioProvider';
import {
  type CapabilityFeatureId,
  getCapabilityUnavailableReason,
} from '@/renderer/lib/radio/capabilityUnavailable';

interface Props {
  feature: CapabilityFeatureId;
  capabilities?: ProtocolCapabilities;
  /** Handler for the action is not wired even if the capability flag is on. */
  handlerMissing?: boolean;
  /** Optional DOM id so a disabled control can reference it via `aria-describedby`. */
  id?: string;
  className?: string;
}

/**
 * Short "why unavailable?" note shown beside actions that are gated off by
 * `ProtocolCapabilities`. Renders nothing when the feature is available.
 */
export default function CapabilityUnavailableHint({
  feature,
  capabilities,
  handlerMissing,
  id,
  className,
}: Props) {
  const { t } = useTranslation();
  const reason = getCapabilityUnavailableReason(capabilities, feature, { handlerMissing });
  if (!reason) return null;

  return (
    <p
      id={id}
      role="note"
      data-capability-unavailable={feature}
      className={className ?? 'text-ink-300 text-xs'}
    >
      {t(reason.reasonKey)}
    </p>
  );
}
