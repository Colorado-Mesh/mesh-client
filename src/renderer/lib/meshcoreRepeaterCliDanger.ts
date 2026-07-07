/** Destructive repeater CLI verbs — matches MeshMonitor remote-admin guard. */
export const MESHCORE_REPEATER_CLI_DANGER_PATTERN = /(reboot|erase|clkreboot|factory)/i;

export function isMeshcoreRepeaterCliDangerCommand(command: string): boolean {
  return MESHCORE_REPEATER_CLI_DANGER_PATTERN.test(command.trim());
}
