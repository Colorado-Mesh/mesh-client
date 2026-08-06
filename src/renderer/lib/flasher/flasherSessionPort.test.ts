import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LAST_SERIAL_PORT_KEY } from '@/renderer/lib/serialPortSignature';

import {
  clearFlasherFlashSession,
  clearFlasherProvisionCompleted,
  getFlasherSessionPortId,
  getFlasherSessionSerialPort,
  getPostFlashBootWaitMs,
  hasFlasherFlashCompleted,
  hasFlasherProvisionCompleted,
  markFlasherFlashCompleted,
  markFlasherProvisionCompleted,
  setFlasherSessionPortId,
  setFlasherSessionSerialPort,
} from './flasherSessionPort';

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
  };
}

describe('flasherSessionPort', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageMock());
    vi.useFakeTimers();
    clearFlasherFlashSession();
  });

  it('persists picker port id for session reuse', () => {
    setFlasherSessionPortId('heltec-port-id');
    expect(getFlasherSessionPortId()).toBe('heltec-port-id');
    expect(localStorage.getItem(LAST_SERIAL_PORT_KEY)).toBe('heltec-port-id');
  });

  it('waits for post-flash boot settle within five seconds', () => {
    markFlasherFlashCompleted();
    expect(getPostFlashBootWaitMs()).toBe(5000);
    vi.advanceTimersByTime(2000);
    expect(getPostFlashBootWaitMs()).toBe(3000);
    vi.advanceTimersByTime(3000);
    expect(getPostFlashBootWaitMs()).toBe(0);
  });

  it('clears session serial port on flash session reset', () => {
    const port = { getInfo: () => ({}) } as SerialPort;
    setFlasherSessionSerialPort(port);
    markFlasherFlashCompleted();
    clearFlasherFlashSession();
    expect(getFlasherSessionSerialPort()).toBeNull();
    expect(getPostFlashBootWaitMs()).toBe(0);
  });

  it('tracks flash completion for Admin remount unlock', () => {
    expect(hasFlasherFlashCompleted()).toBe(false);
    markFlasherFlashCompleted();
    expect(hasFlasherFlashCompleted()).toBe(true);
    clearFlasherFlashSession();
    expect(hasFlasherFlashCompleted()).toBe(false);
  });

  it('tracks provision completion and clears it with the flash session', () => {
    markFlasherFlashCompleted();
    markFlasherProvisionCompleted();
    expect(hasFlasherProvisionCompleted()).toBe(true);
    clearFlasherFlashSession();
    expect(hasFlasherFlashCompleted()).toBe(false);
    expect(hasFlasherProvisionCompleted()).toBe(false);
  });

  it('clearFlasherProvisionCompleted clears provision only', () => {
    markFlasherFlashCompleted();
    markFlasherProvisionCompleted();
    clearFlasherProvisionCompleted();
    expect(hasFlasherFlashCompleted()).toBe(true);
    expect(hasFlasherProvisionCompleted()).toBe(false);
  });
});
