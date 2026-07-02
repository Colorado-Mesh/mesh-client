/** Last-wins dedupe for channel pill lists keyed by slot index. */
export function dedupeChannelPillsByIndex<T extends { index: number }>(
  channels: readonly T[],
): T[] {
  const byIndex = new Map<number, T>();
  for (const ch of channels) {
    byIndex.set(ch.index, ch);
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}
