import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';

import { createSidecarBootstrap, superviseChild } from './run-reticulum-sidecar-dev.mjs';

class MockProcess extends EventEmitter {
  pid = 1234;

  kills = [];

  kill(pid, signal) {
    this.kills.push({ pid, signal, listeners: this.listenerCount(signal) });
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  it(`superviseChild forwards ${signal} and restores default handling before re-raising`, () => {
    const child = new EventEmitter();
    const childKills = [];
    child.kill = (forwardedSignal) => childKills.push(forwardedSignal);
    const hostProcess = new MockProcess();

    superviseChild(child, hostProcess);
    hostProcess.emit(signal);
    child.emit('exit', null, signal);

    expect(childKills).toEqual([signal]);
    expect(hostProcess.kills).toEqual([{ pid: 1234, signal, listeners: 0 }]);
    expect(hostProcess.listenerCount('SIGINT')).toBe(0);
    expect(hostProcess.listenerCount('SIGTERM')).toBe(0);
  });
}

it('superviseChild preserves an ordinary child exit code', () => {
  const child = new EventEmitter();
  child.kill = () => {
    throw new Error('ordinary exit must not forward a signal');
  };
  const hostProcess = new MockProcess();

  superviseChild(child, hostProcess);
  child.emit('exit', 7, null);

  expect(hostProcess.exitCode).toBe(7);
  expect(hostProcess.kills).toEqual([]);
  expect(hostProcess.listenerCount('SIGINT')).toBe(0);
  expect(hostProcess.listenerCount('SIGTERM')).toBe(0);
});

it('creates distinct random credentials for sidecar auth and picker capabilities', () => {
  const first = createSidecarBootstrap();
  const second = createSidecarBootstrap();

  expect(Buffer.from(first.auth_token, 'base64url')).toHaveLength(32);
  expect(Buffer.from(first.capability_issuer_token, 'base64url')).toHaveLength(32);
  expect(Buffer.from(first.capability_session_id, 'base64url')).toHaveLength(16);
  expect(new Set(Object.values(first))).toHaveLength(3);
  expect(second).not.toEqual(first);
});
