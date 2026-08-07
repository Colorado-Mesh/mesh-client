import { describe, expect, it, vi } from 'vitest';

import { raceWithDeadline } from '@/renderer/lib/bleReconnectHelper';
import {
  isReticulumIpcSendTimeout,
  RETICULUM_IPC_SEND_TIMEOUT_TAG,
  withReticulumIpcSendDeadline,
} from '@/renderer/lib/reticulum/reticulumIpcDeadline';
import { RETICULUM_IPC_SEND_TIMEOUT_MS } from '@/renderer/lib/timeConstants';

vi.mock('@/renderer/lib/bleReconnectHelper', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    raceWithDeadline: vi.fn(
      (actual as { raceWithDeadline: typeof raceWithDeadline }).raceWithDeadline,
    ),
  };
});

describe('reticulumIpcDeadline', () => {
  it('delegates to raceWithDeadline with the shared send budget', async () => {
    const work = Promise.resolve('ok');
    await expect(withReticulumIpcSendDeadline(work)).resolves.toBe('ok');
    expect(raceWithDeadline).toHaveBeenCalledWith(
      work,
      RETICULUM_IPC_SEND_TIMEOUT_MS,
      RETICULUM_IPC_SEND_TIMEOUT_TAG,
    );
  });

  it('detects timeout tag errors', () => {
    expect(isReticulumIpcSendTimeout(new Error(RETICULUM_IPC_SEND_TIMEOUT_TAG))).toBe(true);
    expect(isReticulumIpcSendTimeout(new Error('other'))).toBe(false);
  });
});
