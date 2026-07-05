import { describe, expect, it, vi } from 'vitest';

import {
  clearMeshcoreWaitingMessagesFollowUp,
  getMeshcoreProcessWaitingMessagesInFlight,
  requestMeshcoreWaitingMessagesFollowUp,
  resetMeshcoreProcessWaitingMessagesSync,
  setMeshcoreProcessWaitingMessagesInFlight,
  takeMeshcoreWaitingMessagesFollowUp,
} from './meshcoreWaitingMessagesSyncState';

describe('meshcoreWaitingMessagesSyncState follow-up chaining', () => {
  it('requests follow-up only while a drain is in flight', () => {
    clearMeshcoreWaitingMessagesFollowUp();
    requestMeshcoreWaitingMessagesFollowUp();
    expect(takeMeshcoreWaitingMessagesFollowUp()).toBe(false);

    const inFlight = Promise.resolve();
    setMeshcoreProcessWaitingMessagesInFlight(inFlight);
    requestMeshcoreWaitingMessagesFollowUp();
    expect(takeMeshcoreWaitingMessagesFollowUp()).toBe(true);
    expect(takeMeshcoreWaitingMessagesFollowUp()).toBe(false);
  });

  it('clears follow-up and silent drain UI on reset', () => {
    const setWaitingMessagesCount = vi.fn();
    const setWaitingMessagesSyncActive = vi.fn();
    const setWaitingMessagesSyncProgress = vi.fn();
    const setWaitingMessagesSilentDrainActive = vi.fn();
    const setWaitingMessagesDrainDeferred = vi.fn();

    setMeshcoreProcessWaitingMessagesInFlight(Promise.resolve());
    requestMeshcoreWaitingMessagesFollowUp();

    resetMeshcoreProcessWaitingMessagesSync(
      setWaitingMessagesCount,
      setWaitingMessagesSyncActive,
      setWaitingMessagesSyncProgress,
      setWaitingMessagesSilentDrainActive,
      setWaitingMessagesDrainDeferred,
    );

    expect(getMeshcoreProcessWaitingMessagesInFlight()).toBeNull();
    expect(takeMeshcoreWaitingMessagesFollowUp()).toBe(false);
    expect(setWaitingMessagesSilentDrainActive).toHaveBeenCalledWith(false);
    expect(setWaitingMessagesDrainDeferred).toHaveBeenCalledWith(false);
  });
});
