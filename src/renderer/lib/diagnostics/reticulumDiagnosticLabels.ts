import type { TFunction } from 'i18next';

import { reticulumIfaceTypeLabel } from '@/renderer/lib/reticulum/reticulumInterfaceLabels';
import type { RfDiagnosticRow } from '@/renderer/lib/types';

export function translateReticulumDiagnosticCause(t: TFunction, row: RfDiagnosticRow): string {
  if (!row.causeI18n) {
    return row.cause;
  }
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(row.causeI18n.params ?? {})) {
    if (typeof value === 'string') {
      params[key] = value;
    } else if (typeof value === 'number') {
      params[key] = String(value);
    }
  }
  if (typeof params.type === 'string') {
    params.type = reticulumIfaceTypeLabel(params.type);
  }
  if (typeof params.status === 'string') {
    params.status = t(`connectionPanel.reticulumInterfaces.status.${params.status}`, {
      defaultValue: params.status,
    });
  }
  return t(row.causeI18n.key, params);
}
