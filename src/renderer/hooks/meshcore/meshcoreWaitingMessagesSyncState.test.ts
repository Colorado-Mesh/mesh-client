import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearMeshcoreWaitingMessagesFollowUp,
  getMeshcoreProcessWaitingMessagesInFlight,
  requestMeshcoreWaitingMessagesFollowUp,
  requestMeshcoreWaitingMessagesManualFollowUp,
  resetMeshcoreProcessWaitingMessagesSync,
  setMeshcoreProcessWaitingMessagesInFlight,
  takeMeshcoreWaitingMessagesFollowUp,
  takeMeshcoreWaitingMessagesManualFollowUp,
} from './meshcoreWaitingMessagesSyncState';

describe('meshcoreWaitingMessagesSyncState follow-up chaining', () => {
  beforeEach(() => {
    setMeshcoreProcessWaitingMessagesInFlight(null);
    clearMeshcoreWaitingMessagesFollowUp();
  });

  it('requests follow-up only while a drain is in flight', () => {
    requestMeshcoreWaitingMessagesFollowUp();
    expect(takeMeshcoreWaitingMessagesFollowUp()).toBe(false);

    const inFlight = Promise.resolve();
    setMeshcoreProcessWaitingMessagesInFlight(inFlight);
    requestMeshcoreWaitingMessagesFollowUp();
    expect(takeMeshcoreWaitingMessagesFollowUp()).toBe(true);
    expect(takeMeshcoreWaitingMessagesFollowUp()).toBe(false);
  });

  it('requests manual follow-up only while a drain is in flight', () => {
    requestMeshcoreWaitingMessagesManualFollowUp();
    expect(takeMeshcoreWaitingMessagesManualFollowUp()).toBe(false);

    const inFlight = Promise.resolve();
    setMeshcoreProcessWaitingMessagesInFlight(inFlight);
    requestMeshcoreWaitingMessagesManualFollowUp();
    expect(takeMeshcoreWaitingMessagesManualFollowUp()).toBe(true);
    expect(takeMeshcoreWaitingMessagesManualFollowUp()).toBe(false);
  });

  it('manual follow-up takes priority over silent follow-up', () => {
    setMeshcoreProcessWaitingMessagesInFlight(Promise.resolve());
    requestMeshcoreWaitingMessagesFollowUp();
    requestMeshcoreWaitingMessagesManualFollowUp();
    expect(takeMeshcoreWaitingMessagesManualFollowUp()).toBe(true);
    expect(takeMeshcoreWaitingMessagesFollowUp()).toBe(true);
  });

  it('clearMeshcoreWaitingMessagesFollowUp resets both silent and manual follow-up flags', () => {
    setMeshcoreProcessWaitingMessagesInFlight(Promise.resolve());
    requestMeshcoreWaitingMessagesFollowUp();
    requestMeshcoreWaitingMessagesManualFollowUp();
    clearMeshcoreWaitingMessagesFollowUp();
    expect(takeMeshcoreWaitingMessagesFollowUp()).toBe(false);
    expect(takeMeshcoreWaitingMessagesManualFollowUp()).toBe(false);
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
