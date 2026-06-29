import type { ReticulumRuntime } from '../../runtime/useReticulumRuntime';

const session: { runtime: ReticulumRuntime | null } = { runtime: null };

export function bindReticulumSession(runtime: ReticulumRuntime): void {
  session.runtime = runtime;
}

export function tryGetReticulumSession(): ReticulumRuntime | null {
  return session.runtime;
}

export function getReticulumSession(): ReticulumRuntime {
  if (!session.runtime) {
    throw new Error('getReticulumSession: runtime not bound — mount useReticulumRuntime from App');
  }
  return session.runtime;
}

/** Typed send helper — ProtocolRuntime declares sendMessage as `never[]` for cross-protocol surface. */
export type ReticulumSendMessageFn = (
  text: string,
  to: number | string,
  replyToHash?: string,
) => Promise<void>;

export function getReticulumSendMessage(
  runtime: ReticulumRuntime | null,
): ReticulumSendMessageFn | null {
  if (!runtime) return null;
  return runtime.sendMessage as ReticulumSendMessageFn;
}
