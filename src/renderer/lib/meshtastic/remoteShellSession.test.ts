import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRemoteShellStore } from '../../stores/remoteShellStore';
import { emptyRemoteShellFrame, type RemoteShellFrame, type RemoteShellOp } from './remoteShell';
import {
  abandonRemoteShellForIdentity,
  closeRemoteShell,
  handleRemoteShellFrame,
  openRemoteShell,
  REMOTE_SHELL_ACK_DELAY_MS,
  REMOTE_SHELL_IDLE_TIMEOUT_MS,
  REMOTE_SHELL_OPEN_TIMEOUT_MS,
  resetRemoteShellSessionForTests,
  sendRemoteShellInput,
  setRemoteShellSender,
} from './remoteShellSession';

vi.mock('../identityByProtocol', () => ({ getIdentityIdForProtocol: () => 'mt-id' }));

const NODE = 0xabcdef12;
const sent: RemoteShellFrame[] = [];

function reply(op: RemoteShellOp, patch: Partial<RemoteShellFrame> = {}, from = NODE): void {
  const { sessionId } = useRemoteShellStore.getState();
  handleRemoteShellFrame('mt-id', from, { ...emptyRemoteShellFrame(op, sessionId), ...patch });
}
const out = (text: string, seq: number) => {
  reply('output', { seq, payload: new TextEncoder().encode(text) });
};

describe('remoteShellSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sent.length = 0;
    setRemoteShellSender((_id, _dest, frame) => {
      sent.push(frame);
      return Promise.resolve();
    });
  });
  afterEach(() => {
    resetRemoteShellSessionForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens: sends OPEN with a nonzero session id and reaches open on OPEN_OK', () => {
    expect(openRemoteShell(NODE, { cols: 100, rows: 30 })).toBe(true);
    const s = useRemoteShellStore.getState();
    expect(s.phase).toBe('opening');
    expect(s.sessionId).not.toBe(0);
    expect(sent[0]).toMatchObject({
      op: 'open',
      cols: 100,
      rows: 30,
      seq: 1,
      sessionId: s.sessionId,
    });
    reply('openOk');
    expect(useRemoteShellStore.getState().phase).toBe('open');
  });

  it('refuses a second open while one is active', () => {
    openRemoteShell(NODE);
    expect(openRemoteShell(NODE)).toBe(false);
  });

  it('fails with open_timeout when the node never answers', () => {
    openRemoteShell(NODE);
    vi.advanceTimersByTime(REMOTE_SHELL_OPEN_TIMEOUT_MS + 1);
    expect(useRemoteShellStore.getState()).toMatchObject({
      phase: 'error',
      errorCode: 'open_timeout',
    });
  });

  it('buffers output, strips control sequences, and drops duplicate/old seq', () => {
    openRemoteShell(NODE);
    reply('openOk');
    out('hello \u001b[31mred\u001b[0m\r\n', 1);
    out('dup', 1);
    out('world', 2);
    expect(useRemoteShellStore.getState().output).toBe('hello red\nworld');
  });

  it('counts skipped sequence numbers and sends one coalesced ACK', () => {
    openRemoteShell(NODE);
    reply('openOk');
    out('a', 1);
    out('b', 4);
    expect(useRemoteShellStore.getState().gapCount).toBe(2);
    sent.length = 0;
    vi.advanceTimersByTime(REMOTE_SHELL_ACK_DELAY_MS + 1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ op: 'ack', ackSeq: 4 });
  });

  it('ignores frames from another node or session', () => {
    openRemoteShell(NODE);
    reply('openOk');
    reply('output', { seq: 1, payload: new TextEncoder().encode('evil') }, 0x99);
    handleRemoteShellFrame('mt-id', NODE, {
      ...emptyRemoteShellFrame('output', 12345),
      seq: 1,
      payload: new TextEncoder().encode('evil'),
    });
    expect(useRemoteShellStore.getState().output).toBe('');
  });

  it('chunks input into ordered INPUT frames and requires an open session', async () => {
    expect(sendRemoteShellInput('ls\n')).toBe(false);
    openRemoteShell(NODE);
    reply('openOk');
    sent.length = 0;
    expect(sendRemoteShellInput('x'.repeat(400))).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((f) => f.op)).toEqual(['input', 'input', 'input']);
    expect(sent.map((f) => f.seq)).toEqual([2, 3, 4]);
  });

  it('close sends CLOSE and keeps the transcript; remote CLOSED ends the session', () => {
    openRemoteShell(NODE);
    reply('openOk');
    out('keep', 1);
    sent.length = 0;
    closeRemoteShell();
    expect(sent[0]?.op).toBe('close');
    expect(useRemoteShellStore.getState()).toMatchObject({ phase: 'closed', output: 'keep' });

    openRemoteShell(NODE);
    reply('openOk');
    reply('closed');
    expect(useRemoteShellStore.getState().phase).toBe('closed');
  });

  it('auto-closes an idle session', () => {
    openRemoteShell(NODE);
    reply('openOk');
    sent.length = 0;
    vi.advanceTimersByTime(REMOTE_SHELL_IDLE_TIMEOUT_MS + 1);
    expect(sent[0]?.op).toBe('close');
    expect(useRemoteShellStore.getState()).toMatchObject({
      phase: 'error',
      errorCode: 'idle_timeout',
    });
  });

  it('remote ERROR while opening fails the session; while open it is recorded', () => {
    openRemoteShell(NODE);
    reply('error', { payload: new TextEncoder().encode('denied\u0007') });
    expect(useRemoteShellStore.getState()).toMatchObject({
      phase: 'error',
      errorCode: 'remote_error',
    });

    openRemoteShell(NODE);
    reply('openOk');
    reply('error', { payload: new TextEncoder().encode('oops') });
    expect(useRemoteShellStore.getState()).toMatchObject({
      phase: 'open',
      errorCode: 'remote_error',
      errorDetail: 'oops',
    });
  });

  it('fails with send_failed when the radio rejects OPEN', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setRemoteShellSender(() => Promise.reject(new Error('radio gone')));
    openRemoteShell(NODE);
    await vi.advanceTimersByTimeAsync(0);
    expect(useRemoteShellStore.getState()).toMatchObject({
      phase: 'error',
      errorCode: 'send_failed',
    });
  });

  it('rejects an invalid node number', () => {
    expect(openRemoteShell(0)).toBe(false);
    expect(useRemoteShellStore.getState().errorCode).toBe('no_radio');
  });

  it('abandon drops the session and transcript for that identity only', () => {
    openRemoteShell(NODE);
    reply('openOk');
    out('secret', 1);
    abandonRemoteShellForIdentity('other');
    expect(useRemoteShellStore.getState().output).toBe('secret');
    abandonRemoteShellForIdentity('mt-id');
    expect(useRemoteShellStore.getState()).toMatchObject({ phase: 'idle', output: '' });
  });
});
