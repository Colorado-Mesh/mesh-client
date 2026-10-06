/** Destructive infra CLI verbs — matches MeshMonitor remote-admin guard (+ poweroff). */
export const MESHCORE_REPEATER_CLI_DANGER_PATTERN =
  /(reboot|erase|clkreboot|factory|shutdown|poweroff)/i;

/**
 * Non-destructive commands that still lock or retune the radio, so the CLI
 * confirm modal must accept them before they are sent.
 * `set cad on` can lock the radio for about 4 seconds. FEM TX gain is Station G3 only.
 */
const MESHCORE_REPEATER_CLI_CONFIRM_COMMANDS = new Set([
  'set cad on',
  'set radio.fem.txgain on',
  'set radio.fem.txgain off',
]);

export function isMeshcoreRepeaterCliDangerCommand(command: string): boolean {
  const trimmed = command.trim().toLowerCase();
  if (MESHCORE_REPEATER_CLI_CONFIRM_COMMANDS.has(trimmed)) return true;
  return MESHCORE_REPEATER_CLI_DANGER_PATTERN.test(trimmed);
}
