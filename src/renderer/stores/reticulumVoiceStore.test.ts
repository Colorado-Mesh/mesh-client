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
      lastTerminalReason: null,
      callGeneration: 0,
      callStartedAtMs: null,
      callEstablishedAtMs: null,
      stats: { txFrames: 0, txPackets: 0, rxFrames: 0, localTxDrops: 0 },
    });
  });

  it('tracks idle → incoming → terminated', () => {
    const store = useReticulumVoiceStore.getState();
    store.applyIncoming(CALL);
    expect(useReticulumVoiceStore.getState().incomingCall?.status).toBe('ringing');
    expect(useReticulumVoiceStore.getState().activeCall?.remote_identity).toBe(
      CALL.remote_identity,
    );
    expect(useReticulumVoiceStore.getState().callStartedAtMs).toBeTypeOf('number');

    store.applyUpdate({
      type: 'snapshot',
      active_call: { ...CALL, status: 'established', answered: true },
    });
    expect(useReticulumVoiceStore.getState().activeCall?.status).toBe('established');
    expect(useReticulumVoiceStore.getState().incomingCall).toBeNull();
    expect(useReticulumVoiceStore.getState().callEstablishedAtMs).toBeTypeOf('number');

    store.applyTerminated(CALL.link_id);
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
    expect(useReticulumVoiceStore.getState().incomingCall).toBeNull();
    expect(useReticulumVoiceStore.getState().callStartedAtMs).toBeNull();
  });

  it('applyStatus clears incomingCall once call leaves ringing/available', () => {
    useReticulumVoiceStore.getState().applyIncoming(CALL);
    useReticulumVoiceStore.getState().applyStatus({
      enabled: true,
      running: true,
      active_call: { ...CALL, status: 'connecting', answered: true },
    });
    expect(useReticulumVoiceStore.getState().activeCall?.status).toBe('connecting');
    expect(useReticulumVoiceStore.getState().incomingCall).toBeNull();
  });

  it('applyTerminated without link id leaves call with a real link unchanged', () => {
    useReticulumVoiceStore.getState().applyIncoming(CALL);
    useReticulumVoiceStore.getState().applyTerminated(null, 'busy');
    useReticulumVoiceStore.getState().applyTerminated('', 'busy');
    useReticulumVoiceStore.getState().applyTerminated('   ', 'busy');
    expect(useReticulumVoiceStore.getState().activeCall?.link_id).toBe(CALL.link_id);
    expect(useReticulumVoiceStore.getState().incomingCall?.status).toBe('ringing');
  });

  it('applyTerminated without link id clears outgoing pending (empty link)', () => {
    useReticulumVoiceStore.getState().beginOutgoing('c'.repeat(32));
    useReticulumVoiceStore.getState().applyTerminated('', 'busy');
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
  });

  it('applyError ignores stale callGeneration', () => {
    useReticulumVoiceStore.getState().beginOutgoing('c'.repeat(32));
    const gen = useReticulumVoiceStore.getState().callGeneration;
    useReticulumVoiceStore.getState().applyError('stale', { callGeneration: gen - 1 });
    expect(useReticulumVoiceStore.getState().activeCall?.status).toBe('calling');
    useReticulumVoiceStore.getState().applyError('fresh', { callGeneration: gen });
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
  });

  it('beginOutgoing sets calling before WS and hangup clears stats', () => {
    const id = 'c'.repeat(32);
    useReticulumVoiceStore.getState().beginOutgoing(id);
    const state = useReticulumVoiceStore.getState();
    expect(state.activeCall?.status).toBe('calling');
    expect(state.activeCall?.remote_identity).toBe(id);
    expect(state.callStartedAtMs).toBeTypeOf('number');

    useReticulumVoiceStore.getState().applyStats({
      link_id: '',
      tx_frames: 3,
      tx_packets: 2,
      rx_frames: 1,
    });
    expect(useReticulumVoiceStore.getState().stats.txFrames).toBe(3);

    useReticulumVoiceStore.getState().clearCall();
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
    expect(useReticulumVoiceStore.getState().stats.txFrames).toBe(0);
    expect(useReticulumVoiceStore.getState().callStartedAtMs).toBeNull();
  });

  it('accumulates stats and ignores stale link_id', () => {
    useReticulumVoiceStore.getState().applyUpdate({
      type: 'outgoing',
      link_id: 'a'.repeat(32),
      remote_identity: 'b'.repeat(32),
    });
    useReticulumVoiceStore.getState().applyStats({
      link_id: 'a'.repeat(32),
      tx_frames: 5,
      tx_packets: 4,
      rx_frames: 2,
    });
    useReticulumVoiceStore.getState().applyStats({
      link_id: 'f'.repeat(32),
      tx_frames: 99,
      rx_frames: 99,
    });
    expect(useReticulumVoiceStore.getState().stats).toEqual({
      txFrames: 5,
      txPackets: 4,
      rxFrames: 2,
      localTxDrops: 0,
    });
  });

  it('toggles mute and clears on error with terminal reason', () => {
    const store = useReticulumVoiceStore.getState();
    store.applyIncoming(CALL);
    store.setMicrophoneMuted(true);
    expect(useReticulumVoiceStore.getState().microphoneMuted).toBe(true);
    store.applyError('boom');
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
    expect(useReticulumVoiceStore.getState().lastError).toBe('boom');
    expect(useReticulumVoiceStore.getState().lastTerminalReason).toBe('boom');
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
    store.applyTerminated(oldLink, 'busy');
    expect(useReticulumVoiceStore.getState().activeCall?.link_id).toBe('c'.repeat(32));
  });

  it('stores busy terminal reason on terminate', () => {
    useReticulumVoiceStore.getState().beginOutgoing('e'.repeat(32));
    useReticulumVoiceStore.getState().applyUpdate({
      type: 'outgoing',
      link_id: 'a'.repeat(32),
      remote_identity: 'e'.repeat(32),
    });
    useReticulumVoiceStore.getState().applyTerminated('a'.repeat(32), 'busy');
    expect(useReticulumVoiceStore.getState().lastTerminalReason).toBe('busy');
    expect(useReticulumVoiceStore.getState().activeCall).toBeNull();
  });

  it('increments local TX drops', () => {
    useReticulumVoiceStore.getState().beginOutgoing('a'.repeat(32));
    useReticulumVoiceStore.getState().incrementLocalTxDrops();
    useReticulumVoiceStore.getState().incrementLocalTxDrops();
    expect(useReticulumVoiceStore.getState().stats.localTxDrops).toBe(2);
  });
});
