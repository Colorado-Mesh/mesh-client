import { afterEach, describe, expect, it, vi } from 'vitest';

import { MESHTASTIC_MODULE_APPLY_TIMEOUT_MS } from '../timeConstants';
import {
  isMeshtasticConfigApplyTimeout,
  withMeshtasticConfigApplyTimeout,
} from './meshtasticConfigApplyTimeout';

describe('meshtasticConfigApplyTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when the underlying promise settles first', async () => {
    await expect(withMeshtasticConfigApplyTimeout(Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('rejects with TIMEOUT when the promise never settles', async () => {
    vi.useFakeTimers();
    const pending = withMeshtasticConfigApplyTimeout(new Promise<void>(() => {}));
    const assertion = expect(pending).rejects.toSatisfy((err: unknown) =>
      isMeshtasticConfigApplyTimeout(err),
    );
    await vi.advanceTimersByTimeAsync(MESHTASTIC_MODULE_APPLY_TIMEOUT_MS);
    await assertion;
  });
});
