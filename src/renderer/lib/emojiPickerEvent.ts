/** Unicode of the emoji chosen in an `emoji-picker-element` `emoji-click` event, or null. */
export function emojiUnicodeFromEvent(event: Event): string | null {
  if (
    !(event instanceof CustomEvent) ||
    typeof event.detail !== 'object' ||
    event.detail === null
  ) {
    return null;
  }
  const detail = event.detail as Record<string, unknown>;
  if (typeof detail.emoji !== 'object' || detail.emoji === null) return null;
  const emoji = detail.emoji as Record<string, unknown>;
  return typeof emoji.unicode === 'string' ? emoji.unicode : null;
}
