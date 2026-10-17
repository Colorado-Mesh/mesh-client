import { MESHTASTIC_MODULE_APPLY_TIMEOUT_MS } from '../timeConstants';

/** Sentinel message for config apply Promise.race timeouts (Modules / Radio). */
export const MESHTASTIC_CONFIG_APPLY_TIMEOUT_MESSAGE = 'TIMEOUT';

export function isMeshtasticConfigApplyTimeout(err: unknown): boolean {
  return err instanceof Error && err.message === MESHTASTIC_CONFIG_APPLY_TIMEOUT_MESSAGE;
}

/** Race a setConfig/setModuleConfig/commit promise against the shared apply budget. */
export async function withMeshtasticConfigApplyTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = MESHTASTIC_MODULE_APPLY_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(MESHTASTIC_CONFIG_APPLY_TIMEOUT_MESSAGE));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}
