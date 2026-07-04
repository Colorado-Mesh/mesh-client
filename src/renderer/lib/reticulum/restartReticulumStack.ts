import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { tryGetReticulumSession } from '@/renderer/lib/sessions/reticulumSession';

export type RestartReticulumStackResult =
  | { ok: true; restarted: true }
  | { ok: true; restarted: false; unavailable: true }
  | { ok: false; message: string };

/** Restart the Reticulum sidecar stack when a session is available. */
export async function restartReticulumStack(opts: {
  onBeginBleConnectGrace?: () => void;
  onRefresh: () => Promise<unknown>;
  logTag?: string;
}): Promise<RestartReticulumStackResult> {
  const session = tryGetReticulumSession();
  if (!session?.restartStack) {
    return { ok: true, restarted: false, unavailable: true };
  }
  try {
    await session.restartStack();
    opts.onBeginBleConnectGrace?.();
    await opts.onRefresh();
    return { ok: true, restarted: true };
  } catch (e) {
    const message = errLikeToLogString(e);
    console.error(`[${opts.logTag ?? 'restartReticulumStack'}] restart stack failed ${message}`);
    return { ok: false, message };
  }
}
