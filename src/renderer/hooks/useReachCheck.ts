import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReachCheckApi, ReachCheckErrorCode } from '@/shared/reachCheck';

import type { MeshcoreChatChannelSource } from '../lib/meshcoreConfiguredChatChannels';
import {
  checkPastedReachCheckKey,
  planReachCheckChannel,
} from '../lib/reachCheck/reachCheckChannel';
import { startReachCheckPolling } from '../lib/reachCheck/reachCheckPoller';
import {
  type ReachCheckServerInputError,
  readReachCheckServerInput,
} from '../lib/reachCheck/reachCheckServerInput';
import { useReachCheckStore } from '../lib/reachCheck/reachCheckStore';
import { MS_PER_SECOND } from '../lib/timeConstants';
import type { IdentityId } from '../lib/types';

/** How long to wait for an added channel to show up in Chat before giving up. */
export const REACH_CHECK_CHANNEL_WAIT_MS = 10 * MS_PER_SECOND;

export type ReachCheckFlowError =
  | ReachCheckErrorCode
  | 'key-mismatch'
  | 'slots-full'
  | 'send-failed'
  | 'channel-timeout'
  | 'add-failed';

export type ReachCheckDialogState =
  | { kind: 'setup'; error?: ReachCheckServerInputError }
  | { kind: 'turnstile'; origin: string; host: string }
  | { kind: 'confirm-add'; name: string; index: number }
  | { kind: 'paste-key'; name: string; error?: 'format' | 'hash' }
  | { kind: 'error'; error: ReachCheckFlowError; retryAfterSeconds?: number; name?: string };

export type ReachCheckDialogAnswer =
  | { kind: 'cancel' }
  | { kind: 'save-server'; url: string }
  | { kind: 'confirm' }
  | { kind: 'paste-key'; hex: string };

export interface UseReachCheckDeps {
  identityId: IdentityId | null;
  /** Radio channels with their keys (MeshCore companion). */
  channels: readonly MeshcoreChatChannelSource[];
  /** Channel indexes Chat currently lists; an added channel is selected once it appears here. */
  channelIndexes: readonly number[];
  setChannel: (index: number, name: string, secret: Uint8Array) => Promise<void>;
  selectChannel: (index: number) => void;
  /** Sends like a typed message on that channel (its saved flood scope applies); returns the id. */
  sendOnChannel: (text: string, index: number) => Promise<string | undefined>;
  api: ReachCheckApi;
  getServerOrigin: () => string;
  saveServerOrigin: (origin: string) => void;
  startPolling?: (sessionId: string) => void;
}

/**
 * One-click MeshCore reach check: server address, bootstrap, test channel (match, add or paste
 * key), session, send, results entry. Nothing is transmitted before the session exists, and the
 * session is created only once the channel is ready.
 */
export function useReachCheck(deps: UseReachCheckDeps): {
  busy: boolean;
  dialog: ReachCheckDialogState | null;
  run: () => void;
  answer: (answer: ReachCheckDialogAnswer) => void;
} {
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<ReachCheckDialogState | null>(null);
  const depsRef = useRef(deps);
  const busyRef = useRef(false);
  const answerRef = useRef<((answer: ReachCheckDialogAnswer) => void) | null>(null);
  const channelWaitRef = useRef<{ index: number; resolve: (appeared: boolean) => void } | null>(
    null,
  );

  useEffect(() => {
    depsRef.current = deps;
  });

  useEffect(() => {
    const wait = channelWaitRef.current;
    if (wait && deps.channelIndexes.includes(wait.index)) {
      channelWaitRef.current = null;
      wait.resolve(true);
    }
  }, [deps.channelIndexes]);

  const ask = useCallback(
    (state: ReachCheckDialogState) =>
      new Promise<ReachCheckDialogAnswer>((resolve) => {
        answerRef.current = resolve;
        setDialog(state);
      }),
    [],
  );

  /** Ends the flow; a final dialog (error, browser check) stays until the user answers it. */
  const finish = useCallback((state: ReachCheckDialogState | null) => {
    busyRef.current = false;
    setBusy(false);
    answerRef.current = state
      ? () => {
          answerRef.current = null;
          setDialog(null);
        }
      : null;
    setDialog(state);
  }, []);

  const waitForChannel = useCallback((index: number) => {
    if (depsRef.current.channelIndexes.includes(index)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (channelWaitRef.current?.index === index) channelWaitRef.current = null;
        resolve(false);
      }, REACH_CHECK_CHANNEL_WAIT_MS);
      channelWaitRef.current = {
        index,
        resolve: (appeared) => {
          clearTimeout(timer);
          resolve(appeared);
        },
      };
    });
  }, []);

  const flow = useCallback(async (): Promise<void> => {
    const identityId = depsRef.current.identityId;
    if (!identityId) {
      finish(null);
      return;
    }

    let origin = depsRef.current.getServerOrigin();
    if (!origin) {
      let state: ReachCheckDialogState = { kind: 'setup' };
      for (;;) {
        const answer = await ask(state);
        if (answer.kind !== 'save-server') {
          finish(null);
          return;
        }
        const read = readReachCheckServerInput(answer.url);
        if (read.ok && read.origin) {
          origin = read.origin;
          depsRef.current.saveServerOrigin(origin);
          setDialog(null);
          break;
        }
        state = { kind: 'setup', error: read.ok ? 'invalid_url' : read.error };
      }
    }

    const boot = await depsRef.current.api.bootstrap(origin);
    if (!boot.ok) {
      finish({ kind: 'error', error: boot.error });
      return;
    }
    const server = boot.value;
    const plan = await planReachCheckChannel(depsRef.current.channels, server);

    let index: number;
    let added: { name: string; secret: Uint8Array } | null = null;
    if (plan.kind === 'ready') {
      index = plan.index;
    } else if (plan.kind === 'key-mismatch') {
      finish({ kind: 'error', error: 'key-mismatch', name: plan.name });
      return;
    } else if (plan.kind === 'slots-full') {
      finish({ kind: 'error', error: 'slots-full' });
      return;
    } else if (plan.kind === 'add-hashtag') {
      const answer = await ask({ kind: 'confirm-add', name: plan.name, index: plan.index });
      if (answer.kind !== 'confirm') {
        finish(null);
        return;
      }
      index = plan.index;
      added = { name: plan.name, secret: plan.secret };
    } else {
      let state: ReachCheckDialogState = { kind: 'paste-key', name: plan.name };
      for (;;) {
        const answer = await ask(state);
        if (answer.kind !== 'paste-key') {
          finish(null);
          return;
        }
        const checked = checkPastedReachCheckKey(answer.hex, server.channelHash);
        if (checked.ok) {
          added = { name: plan.name, secret: checked.secret };
          break;
        }
        state = { kind: 'paste-key', name: plan.name, error: checked.reason };
      }
      index = plan.index;
    }

    if (added) {
      setDialog(null);
      try {
        await depsRef.current.setChannel(index, added.name, added.secret);
      } catch (e: unknown) {
        console.debug('[useReachCheck] add channel failed', e instanceof Error ? e.message : e);
        finish({ kind: 'error', error: 'add-failed', name: added.name });
        return;
      }
      if (!(await waitForChannel(index))) {
        finish({ kind: 'error', error: 'channel-timeout' });
        return;
      }
    }
    depsRef.current.selectChannel(index);

    if (server.turnstileRequired) {
      finish({ kind: 'turnstile', origin, host: new URL(origin).hostname });
      return;
    }

    const created = await depsRef.current.api.createSession(origin);
    if (!created.ok) {
      finish(
        created.retryAfterSeconds === undefined
          ? { kind: 'error', error: created.error }
          : { kind: 'error', error: created.error, retryAfterSeconds: created.retryAfterSeconds },
      );
      return;
    }
    const session = created.value;
    let messageId: string | undefined;
    try {
      messageId = await depsRef.current.sendOnChannel(session.code, index);
    } catch (e: unknown) {
      console.debug('[useReachCheck] send failed', e instanceof Error ? e.message : e);
      messageId = undefined;
    }
    if (!messageId) {
      finish({ kind: 'error', error: 'send-failed' });
      return;
    }
    useReachCheckStore.getState().start(identityId, messageId, {
      origin,
      sessionId: session.id,
      code: session.code,
      session,
      state: 'polling',
      startedAt: Date.now(),
    });
    (depsRef.current.startPolling ?? startReachCheckPolling)(session.id);
    finish(null);
  }, [ask, finish, waitForChannel]);

  const run = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    void flow().catch((e: unknown) => {
      console.debug('[useReachCheck] flow failed', e instanceof Error ? e.message : e);
      finish({ kind: 'error', error: 'network' });
    });
  }, [finish, flow]);

  const answer = useCallback((value: ReachCheckDialogAnswer) => {
    const resolve = answerRef.current;
    if (!resolve) return;
    answerRef.current = null;
    resolve(value);
  }, []);

  return { busy, dialog, run, answer };
}
