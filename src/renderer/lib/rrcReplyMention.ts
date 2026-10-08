/** A reply is ordinary room text. Keep an existing draft and avoid duplicate leading mentions. */
export function rrcReplyMention(draft: string, nickname: string): string | null {
  if (/[\p{Cc}\p{Cf}@]/u.test(nickname)) return null;
  const nick = nickname.trim();
  if (!nick) return null;
  const mention = `@${nick} `;
  return draft.toLowerCase().startsWith(mention.toLowerCase()) ? draft : mention + draft;
}
