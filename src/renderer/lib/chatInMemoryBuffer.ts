/**
 * Cap in-memory Meshtastic / MeshCore chat arrays so long sessions cannot grow
 * the renderer heap unbounded. DB reads are separately limited in main IPC.
 */
export const MAX_IN_MEMORY_CHAT_MESSAGES = 2000;

export function trimChatMessagesToMax<T>(messages: T[], maxLen: number): T[] {
  if (messages.length <= maxLen) {
    return messages;
  }
  return messages.slice(messages.length - maxLen);
}
