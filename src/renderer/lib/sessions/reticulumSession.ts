import type { ReticulumRuntime } from '../../runtime/useReticulumRuntime';

const session: { runtime: ReticulumRuntime | null } = { runtime: null };

export function bindReticulumSession(runtime: ReticulumRuntime): void {
  session.runtime = runtime;
}

export function getReticulumSession(): ReticulumRuntime {
  if (!session.runtime) {
    throw new Error('getReticulumSession: runtime not bound — mount useReticulumRuntime from App');
  }
  return session.runtime;
}
