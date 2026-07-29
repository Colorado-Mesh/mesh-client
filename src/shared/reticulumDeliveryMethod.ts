/** Wire / SQLite LXMF delivery method labels (sidecar `delivery_method_label`). */
export const RETICULUM_DELIVERY_METHODS = [
  'direct',
  'propagated',
  'opportunistic',
  'paper',
] as const;

export type ReticulumDeliveryMethod = (typeof RETICULUM_DELIVERY_METHODS)[number];

const ALLOWED = new Set<string>(RETICULUM_DELIVERY_METHODS);

/** Parse sidecar / DB delivery_method; unknown values → undefined. */
export function parseReticulumDeliveryMethod(
  value: string | undefined | null,
): ReticulumDeliveryMethod | undefined {
  if (value == null || value === '') return undefined;
  const normalized = value.trim().toLowerCase();
  return ALLOWED.has(normalized) ? (normalized as ReticulumDeliveryMethod) : undefined;
}
