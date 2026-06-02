/**
 * Distance from the “bottom” of the chat (latest messages). Uses the **maximum** of:
 * - Inner `overflow-y-auto` distance when the message list overflows, and
 * - Message-end sentinel vs `outerScrollRoot` (app main viewport), so we still
 *   detect “not at latest” when the inner scroller is at max but the shell scroll
 *   has moved the thread off-screen (or vice versa).
 */
export function getDistFromChatBottom(
  inner: HTMLDivElement | null,
  messagesEnd: HTMLDivElement | null,
  outerScrollRoot: HTMLElement | null,
): number | null {
  if (!inner) return null;

  let dist = 0;

  if (inner.scrollHeight > inner.clientHeight + 1) {
    dist = Math.max(dist, inner.scrollHeight - inner.scrollTop - inner.clientHeight);
  }

  if (outerScrollRoot && messagesEnd) {
    const rootRect = outerScrollRoot.getBoundingClientRect();
    const endRect = messagesEnd.getBoundingClientRect();
    dist = Math.max(dist, Math.max(0, endRect.bottom - rootRect.bottom));
  }

  return dist;
}
