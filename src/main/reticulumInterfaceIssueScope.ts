/** Parse/validate enabled interface names for `reticulum:syncInterfaceIssueScope`. */

export const MAX_ENABLED_INTERFACE_NAMES = 256;
export const MAX_INTERFACE_NAME_LEN = 128;

/**
 * Coerce IPC payload to trimmed interface names.
 * Empty array (all interfaces disabled) is valid and clears TCP/TX latches.
 * A non-empty payload with only invalid entries throws instead of soft-clearing.
 */
export function parseEnabledInterfaceNames(enabledInterfaceNames: unknown): string[] {
  if (!Array.isArray(enabledInterfaceNames)) {
    throw new Error('enabledInterfaceNames must be an array of strings');
  }
  const names: string[] = [];
  for (const raw of enabledInterfaceNames.slice(0, MAX_ENABLED_INTERFACE_NAMES)) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().slice(0, MAX_INTERFACE_NAME_LEN);
    if (trimmed) names.push(trimmed);
  }
  if (enabledInterfaceNames.length > 0 && names.length === 0) {
    throw new Error('enabledInterfaceNames must contain at least one non-empty string');
  }
  return names;
}
