// @vitest-environment node
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isPackagedMock = vi.hoisted(() => ({ value: true }));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackagedMock.value;
    },
  },
}));

import { assertIpcSender, validateIpcSender } from './validate-ipc-sender';

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
