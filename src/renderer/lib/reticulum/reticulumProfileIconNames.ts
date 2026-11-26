/** Stored / wire names including legacy `circle` (unset). */
const RETICULUM_PROFILE_ICON_NAMES = ['circle', 'star', 'heart', 'shield', 'user'] as const;

/** Icons offered in the peer detail picker (excludes unset/`circle`). */
export type ReticulumProfileIconName = (typeof RETICULUM_PROFILE_ICON_NAMES)[number];

export function isReticulumProfileIconName(
  value: string | null | undefined,
): value is ReticulumProfileIconName {
  return (
    typeof value === 'string' && (RETICULUM_PROFILE_ICON_NAMES as readonly string[]).includes(value)
  );
}
