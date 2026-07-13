import { beforeEach, describe, expect, it, vi } from 'vitest';

const restartStack = vi.fn();
const onRefresh = vi.fn().mockResolvedValue(undefined);

let mockSession: { restartStack: typeof restartStack } | null = { restartStack };

vi.mock('@/renderer/lib/sessions/reticulumSession', () => ({
  tryGetReticulumSession: () => mockSession,
}));

import { restartReticulumStack } from './restartReticulumStack';

describe('restartReticulumStack', () => {
  beforeEach(() => {
    mockSession = { restartStack };
    restartStack.mockReset();
    onRefresh.mockClear();
  });

  it('returns unavailable when session has no restartStack', async () => {
    mockSession = null;
    const result = await restartReticulumStack({ onRefresh });
    expect(result).toEqual({ ok: true, restarted: false, unavailable: true });
  });

  it('surfaces restart failures to the caller', async () => {
    restartStack.mockRejectedValueOnce(new Error('sidecar busy'));
    const result = await restartReticulumStack({ onRefresh, logTag: 'test' });
    expect(result).toEqual({ ok: false, message: 'sidecar busy' });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('refreshes after a successful restart', async () => {
    restartStack.mockResolvedValueOnce(undefined);
    const result = await restartReticulumStack({ onRefresh });
    expect(result).toEqual({ ok: true, restarted: true });
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
