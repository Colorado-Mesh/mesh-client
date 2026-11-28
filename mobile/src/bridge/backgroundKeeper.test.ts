import { beforeEach, describe, expect, it, vi } from 'vitest';

const setBackgroundMode = vi.fn();
vi.mock('./nativePlugins', () => ({
  getPlugin: () => ({ setBackgroundMode }),
}));

describe('backgroundKeeper', () => {
  beforeEach(() => {
    vi.resetModules();
    setBackgroundMode.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('holds the foreground service while a link is live', async () => {
    setBackgroundMode.mockResolvedValue(undefined);
    const keeper = await import('./backgroundKeeper');
    keeper.setWorkerLinksActive(true);
    await keeper.reapplyBackgroundMode();
    expect(setBackgroundMode).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    keeper.setWorkerLinksActive(false);
    await keeper.reapplyBackgroundMode();
    expect(setBackgroundMode).toHaveBeenLastCalledWith({ enabled: false });
    expect(setBackgroundMode).toHaveBeenCalledTimes(2);
  });

  it('retries after Android refuses to start it from the background (EPERM)', async () => {
    setBackgroundMode.mockRejectedValueOnce(new Error('EPERM app is in background'));
    setBackgroundMode.mockResolvedValue(undefined);
    const keeper = await import('./backgroundKeeper');
    keeper.setWorkerLinksActive(true);
    await keeper.reapplyBackgroundMode(); // settles the refused first attempt
    expect(keeper.isBackgroundModeEnabled()).toBe(false);
    expect(setBackgroundMode).toHaveBeenCalledTimes(1);
    await keeper.reapplyBackgroundMode(); // the app came back to the foreground
    expect(keeper.isBackgroundModeEnabled()).toBe(true);
    expect(setBackgroundMode).toHaveBeenCalledTimes(2);
    await keeper.reapplyBackgroundMode(); // nothing left to do
    expect(setBackgroundMode).toHaveBeenCalledTimes(2);
  });
});
