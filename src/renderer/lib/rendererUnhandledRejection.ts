/** Log renderer-wide unhandled promise rejections without throwing a second error. */
export function logRendererUnhandledRejection(reason: unknown): void {
  console.error(
    '[renderer] Unhandled rejection:',
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
  );
}
