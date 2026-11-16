export interface ChatMarkdownToolbarTarget {
  isActive: () => boolean;
  wrap: (before: string, after: string) => void;
}

const targets = new Set<ChatMarkdownToolbarTarget>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function registerChatMarkdownToolbarTarget(target: ChatMarkdownToolbarTarget): () => void {
  targets.add(target);
  notify();
  return () => {
    if (targets.delete(target)) notify();
  };
}

function activeTarget(): ChatMarkdownToolbarTarget | null {
  let fallback: ChatMarkdownToolbarTarget | null = null;
  for (const target of targets) {
    fallback = target;
    if (target.isActive()) return target;
  }
  return fallback;
}

export function applyChatMarkdownWrap(before: string, after: string): boolean {
  const target = activeTarget();
  if (!target) return false;
  target.wrap(before, after);
  return true;
}

export function hasChatMarkdownToolbarTarget(): boolean {
  return targets.size > 0;
}

export function subscribeChatMarkdownToolbarTarget(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetChatMarkdownToolbarTargetForTests(): void {
  targets.clear();
  listeners.clear();
}
