/** Destructive infra CLI verbs — matches MeshMonitor remote-admin guard (+ poweroff). */
export const MESHCORE_REPEATER_CLI_DANGER_PATTERN =
  /(reboot|erase|clkreboot|factory|shutdown|poweroff)/i;

export function isMeshcoreRepeaterCliDangerCommand(command: string): boolean {
  return MESHCORE_REPEATER_CLI_DANGER_PATTERN.test(command.trim());
}
