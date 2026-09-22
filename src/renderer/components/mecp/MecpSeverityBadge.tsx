import { useTranslation } from 'react-i18next';

import type { Severity } from '@/renderer/lib/mecp/mecpMessages';
import { severityLabelKey } from '@/renderer/lib/mecp/mecpMessages';

const SEVERITY_CLASSES: Record<Severity, string> = {
  0: 'bg-red-700 text-white',
  1: 'bg-orange-700 text-white',
  2: 'bg-amber-700 text-white',
  3: 'bg-slate-600 text-white',
};

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
          className={`absolute inset-0 animate-pulse rounded ${SEVERITY_CLASSES[severity]} opacity-60`}
        />
      ) : null}
      <span
        className={`relative rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${SEVERITY_CLASSES[severity]}`}
      >
        {label}
      </span>
    </span>
  );
}
