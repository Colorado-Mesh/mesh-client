import { beforeEach, describe, expect, it } from 'vitest';

import { useReticulumVoiceMemoStore } from './reticulumVoiceMemoStore';

function store() {
  return useReticulumVoiceMemoStore.getState();
}

describe('reticulumVoiceMemoStore', () => {
  beforeEach(() => {
    store().reset();
  });

  it('starts in idle', () => {
    expect(store().phase).toBe('idle');
    expect(store().sessionId).toBeNull();
    expect(store().elapsedSec).toBe(0);
  });

  it('setStarting transitions to starting', () => {
    store().setStarting();
    expect(store().phase).toBe('starting');
    expect(store().lastError).toBeNull();
  });

  it('startRecording stores sessionId and phase', () => {
    store().startRecording('sess-abc');
    expect(store().phase).toBe('recording');
    expect(store().sessionId).toBe('sess-abc');
  });

  it('setStopping transitions to stopping', () => {
    store().startRecording('sess-abc');
    store().setStopping();
    expect(store().phase).toBe('stopping');
  });

  it('applyStopResult stores ogg and duration', () => {
    store().startRecording('sess-abc');
    store().applyStopResult({ oggBase64: 'abc123', durationMs: 5000, sizeBytes: 1024 });
    expect(store().oggBase64).toBe('abc123');
    expect(store().durationMs).toBe(5000);
    expect(store().sizeBytes).toBe(1024);
  });

  it('setError transitions to error', () => {
    store().setError('sidecar_unavailable');
    expect(store().phase).toBe('error');
    expect(store().lastError).toBe('sidecar_unavailable');
  });

  it('reset returns to idle', () => {
    store().startRecording('sess-abc');
    store().applyStopResult({ oggBase64: 'abc', durationMs: 1000, sizeBytes: 100 });
    store().reset();
    expect(store().phase).toBe('idle');
    expect(store().sessionId).toBeNull();
    expect(store().oggBase64).toBeNull();
    expect(store().elapsedSec).toBe(0);
  });

  it('tickElapsed updates elapsedSec', () => {
    store().startRecording('sess-abc');
    store().tickElapsed(42);
    expect(store().elapsedSec).toBe(42);
  });
});
