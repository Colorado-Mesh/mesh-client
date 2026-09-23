import { useTranslation } from 'react-i18next';

import type { Severity } from '@/renderer/lib/mecp/mecpMessages';
import { severityLabelKey } from '@/renderer/lib/mecp/mecpMessages';

/** Badge fill for MECP severity 0–3 (MAYDAY/URGENT red, SAFETY yellow, ROUTINE blue). */
export const MECP_SEVERITY_BADGE_CLASSES: Record<Severity, string> = {
  0: 'bg-red-700 text-white',
  1: 'bg-red-700 text-white',
  2: 'bg-yellow-600 text-black',
  3: 'bg-blue-700 text-white',
};

/** Chat bubble border/fill for parsed MECP payloads (own solid vs received dashed). */
export function mecpChatBubbleToneClasses(severity: Severity, isOwn: boolean): string {
  if (severity <= 1) {
    return isOwn
      ? 'border border-red-400/70 bg-red-900/30 font-semibold'
      : 'border border-dashed border-red-500 bg-red-950/40 font-semibold';
  }
  if (severity === 2) {
    return isOwn
      ? 'border border-yellow-400/70 bg-yellow-900/30 font-semibold'
      : 'border border-dashed border-yellow-500 bg-yellow-950/40 font-semibold';
  }
  return isOwn
    ? 'border border-blue-400/70 bg-blue-900/30 font-semibold'
    : 'border border-dashed border-blue-500 bg-blue-950/40 font-semibold';
}

export function MecpSeverityBadge({
  severity,
  pulse,
}: {
  severity: Severity;
  /** Decorative pulse for MAYDAY/URGENT — must not sit on the text element. */
  pulse?: boolean;
}) {
  const { t } = useTranslation();
  const label = t(severityLabelKey(severity));
  return (
    <span className="relative inline-flex items-center">
      {pulse && severity <= 1 ? (
        <span
          aria-hidden
          className={`absolute inset-0 animate-pulse rounded ${MECP_SEVERITY_BADGE_CLASSES[severity]} opacity-60`}
        />
      ) : null}
      <span
        className={`relative rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${MECP_SEVERITY_BADGE_CLASSES[severity]}`}
      >
        {label}
      </span>
    </span>
  );
}
