/** Recent firmware clientNotification text for config apply error surfacing. */
let lastClientNotification: { message: string; at: number } | null = null;

export function recordMeshtasticClientNotification(message: string): void {
  const trimmed = message.trim();
  if (!trimmed) return;
  lastClientNotification = { message: trimmed, at: Date.now() };
}

/** Returns notification message if one arrived within `withinMs` (default 8s). */
export function peekRecentMeshtasticClientNotification(withinMs = 8000): string | null {
  if (!lastClientNotification) return null;
  if (Date.now() - lastClientNotification.at > withinMs) return null;
  return lastClientNotification.message;
}

export function clearMeshtasticClientNotification(): void {
  lastClientNotification = null;
}
