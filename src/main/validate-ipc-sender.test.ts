// @vitest-environment node
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isPackagedMock = vi.hoisted(() => ({ value: true }));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackagedMock.value;
    },
  },
}));

import { assertIpcSender, suspendIpcSender, validateIpcSender } from './validate-ipc-sender';

function makeEvent(url: string | null): IpcMainInvokeEvent {
  return {
    senderFrame: url === null ? null : { url },
  } as IpcMainInvokeEvent;
}

describe('validateIpcSender', () => {
  beforeEach(() => {
    isPackagedMock.value = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects missing sender frame', () => {
    expect(validateIpcSender(makeEvent(null))).toBe(false);
  });

  it('rejects invalid frame URL', () => {
    expect(validateIpcSender(makeEvent('not-a-url'))).toBe(false);
  });

  it('rejects queued trusted IPC throughout reset, then permits the freshly loaded document', () => {
    const sender = {} as WebContents;
    const frame = { url: 'mesh-client://renderer/index.html' };
    const event = {
      sender,
      senderFrame: frame,
    } as IpcMainInvokeEvent;
    const resume = suspendIpcSender(sender);
    expect(validateIpcSender(event)).toBe(false);
    expect(() => {
      assertIpcSender(event, 'db:saveIncidents');
    }).toThrow('unauthorized sender');
    frame.url = 'about:blank';
    expect(validateIpcSender(event)).toBe(false);
    resume();
    // Resuming never grants the empty document access to privileged IPC.
    expect(validateIpcSender(event)).toBe(false);
    frame.url = 'mesh-client://renderer/index.html';
    expect(validateIpcSender(event)).toBe(true);
  });

  it('rejects detached or stale frame identities after the reset fence is released', () => {
    const sender = {} as WebContents;
    const frame = {
      url: 'mesh-client://renderer/index.html',
      detached: false,
      processId: 10,
      routingId: 20,
    };
    const event = { sender, senderFrame: frame, processId: 10, frameId: 20 } as IpcMainInvokeEvent;
    const resume = suspendIpcSender(sender);
    resume();
    frame.detached = true;
    expect(validateIpcSender(event)).toBe(false);
    frame.detached = false;
    frame.processId = 11;
    expect(validateIpcSender(event)).toBe(false);
    frame.processId = 10;
    frame.routingId = 21;
    expect(validateIpcSender(event)).toBe(false);
  });

  it.each([true, false])('rejects other custom-protocol authorities (packaged: %s)', (packaged) => {
    isPackagedMock.value = packaged;
    for (const url of [
      'mesh-client://evil/index.html',
      'mesh-client://renderer.evil/index.html',
      'mesh-client://renderer:123/index.html',
      'mesh-client://user:pass@renderer/index.html',
      'mesh-client:/index.html',
    ]) {
      expect(validateIpcSender(makeEvent(url))).toBe(false);
    }
  });

  describe('packaged app', () => {
    beforeEach(() => {
      isPackagedMock.value = true;
    });

    it('accepts file: protocol', () => {
      expect(validateIpcSender(makeEvent('file:///Applications/mesh-client.app/index.html'))).toBe(
        true,
      );
    });

    it('accepts mesh-client: protocol', () => {
      expect(validateIpcSender(makeEvent('mesh-client://renderer/index.html'))).toBe(true);
    });

    it('rejects http: and https:', () => {
      expect(validateIpcSender(makeEvent('http://localhost:5173/'))).toBe(false);
      expect(validateIpcSender(makeEvent('https://evil.example/'))).toBe(false);
    });
  });

  describe('dev (unpackaged)', () => {
    beforeEach(() => {
      isPackagedMock.value = false;
    });

    it('accepts localhost http', () => {
      expect(validateIpcSender(makeEvent('http://localhost:5173/'))).toBe(true);
      expect(validateIpcSender(makeEvent('http://127.0.0.1:5173/'))).toBe(true);
    });

    it('accepts https: for dev tooling', () => {
      expect(validateIpcSender(makeEvent('https://localhost:5173/'))).toBe(true);
    });

    it('rejects remote http hosts', () => {
      expect(validateIpcSender(makeEvent('http://evil.example/'))).toBe(false);
    });
  });
});

describe('assertIpcSender', () => {
  it('throws with channel name when sender is unauthorized', () => {
    expect(() => {
      assertIpcSender(makeEvent(null), 'gps:getFix');
    }).toThrow('gps:getFix: unauthorized sender');
  });

  it('does not throw for trusted packaged sender', () => {
    isPackagedMock.value = true;
    expect(() => {
      assertIpcSender(makeEvent('file:///index.html'), 'tak:start');
    }).not.toThrow();
  });
});
