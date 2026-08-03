import { beforeEach, describe, expect, it } from 'vitest';

import { useReticulumVoiceStore } from './reticulumVoiceStore';

const CALL = {
  link_id: 'a'.repeat(32),
  remote_identity: 'b'.repeat(32),
  role: 'incoming' as const,
  status: 'ringing',
  answered: false,
};

describe('reticulumVoiceStore', () => {
  beforeEach(() => {
    useReticulumVoiceStore.getState().clearCall();
    useReticulumVoiceStore.setState({
      enabled: false,
      running: false,
      microphoneMuted: false,
      lastError: null,
      callGeneration: 0,
    });
  });

  it('tracks idle → incoming → terminated', () => {
    const store = useReticulumVoiceStore.getState();
    store.applyIncoming(CALL);
    expect(useReticulumVoiceStore.getState().incomingCall?.status).toBe('ringing');
    expect(useReticulumVoiceStore.getState().activeCall?.remote_identity).toBe(
      CALL.remote_identity,
    );

    store.applyUpdate({
      type: 'snapshot',
      active_call: { ...CALL, status: 'established', answered: true },
    });
    expect(useReticulumVoiceStore.getState().activeCall?.status).toBe('established');

    store.applyTerminated(CALL.link_id);
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
    expect(useReticulumVoiceStore.getState().incomingCall).toBeNull();
  });

  it('toggles mute and clears on error', () => {
    const store = useReticulumVoiceStore.getState();
    store.applyIncoming(CALL);
    store.setMicrophoneMuted(true);
    expect(useReticulumVoiceStore.getState().microphoneMuted).toBe(true);
    store.applyError('boom');
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
    expect(useReticulumVoiceStore.getState().lastError).toBe('boom');
  });

  it('ignores stale terminated after a new call generation', () => {
    const store = useReticulumVoiceStore.getState();
    store.applyIncoming(CALL);
    const oldLink = CALL.link_id;
    store.applyUpdate({
      type: 'outgoing',
      link_id: 'c'.repeat(32),
      remote_identity: 'd'.repeat(32),
    });
    store.applyTerminated(oldLink);
    expect(useReticulumVoiceStore.getState().activeCall?.link_id).toBe('c'.repeat(32));
  });
});
