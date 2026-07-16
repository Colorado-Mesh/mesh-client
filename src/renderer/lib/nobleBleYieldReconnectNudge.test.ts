// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNobleBleYieldReconnectNudge } from './nobleBleYieldReconnectNudge';
import { dispatchNobleBleYieldReleased } from './nobleBleYieldReleased';

interface NudgeGates {
  isBleConnection: boolean;
  isConnected: boolean;
  isExplicitDisconnect: boolean;
  isReconnecting: boolean;
}

function renderNudgeHook(gates: NudgeGates, onNudge: () => void) {
  return renderHook(() => {
    useNobleBleYieldReconnectNudge({
      logTag: 'testRuntime',
      isBleConnection: () => gates.isBleConnection,
      isConnected: () => gates.isConnected,
      isExplicitDisconnect: () => gates.isExplicitDisconnect,
      isReconnecting: () => gates.isReconnecting,
      onNudge,
    });
  });
}

describe('useNobleBleYieldReconnectNudge', () => {
  let gates: NudgeGates;

  beforeEach(() => {
    gates = {
      isBleConnection: true,
      isConnected: false,
      isExplicitDisconnect: false,
      isReconnecting: false,
    };
  });

  it('nudges reconnect when all gates allow it', () => {
    const onNudge = vi.fn();
    renderNudgeHook(gates, onNudge);

    dispatchNobleBleYieldReleased();

    expect(onNudge).toHaveBeenCalledTimes(1);
  });

  it('logs at debug level when nudging', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    renderNudgeHook(gates, vi.fn());

    dispatchNobleBleYieldReleased();

    expect(debugSpy).toHaveBeenCalledWith(
      '[testRuntime] Noble BLE yield released — nudging reconnect',
    );
    debugSpy.mockRestore();
  });

  it('does not nudge when the current connection is not BLE', () => {
    gates.isBleConnection = false;
    const onNudge = vi.fn();
    renderNudgeHook(gates, onNudge);

    dispatchNobleBleYieldReleased();

    expect(onNudge).not.toHaveBeenCalled();
  });

  it('does not nudge after an explicit user disconnect', () => {
    gates.isExplicitDisconnect = true;
    const onNudge = vi.fn();
    renderNudgeHook(gates, onNudge);

    dispatchNobleBleYieldReleased();

    expect(onNudge).not.toHaveBeenCalled();
  });

  it('does not nudge when already connected', () => {
    gates.isConnected = true;
    const onNudge = vi.fn();
    renderNudgeHook(gates, onNudge);

    dispatchNobleBleYieldReleased();

    expect(onNudge).not.toHaveBeenCalled();
  });

  it('does not nudge when a reconnect is already in progress', () => {
    gates.isReconnecting = true;
    const onNudge = vi.fn();
    renderNudgeHook(gates, onNudge);

    dispatchNobleBleYieldReleased();

    expect(onNudge).not.toHaveBeenCalled();
  });

  it('ignores unrelated window events', () => {
    const onNudge = vi.fn();
    renderNudgeHook(gates, onNudge);

    window.dispatchEvent(new CustomEvent('mesh-client:someOtherEvent'));

    expect(onNudge).not.toHaveBeenCalled();
  });

  it('removes the listener on unmount (no nudge after teardown)', () => {
    const onNudge = vi.fn();
    const { unmount } = renderNudgeHook(gates, onNudge);

    unmount();
    dispatchNobleBleYieldReleased();

    expect(onNudge).not.toHaveBeenCalled();
  });

  it('re-subscribes when a gate callback identity changes', () => {
    const onNudge = vi.fn();
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const addSpy = vi.spyOn(window, 'addEventListener');

    const { rerender } = renderHook(
      ({ isBleConnection }: { isBleConnection: () => boolean }) => {
        useNobleBleYieldReconnectNudge({
          logTag: 'testRuntime',
          isBleConnection,
          isConnected: () => gates.isConnected,
          isExplicitDisconnect: () => gates.isExplicitDisconnect,
          isReconnecting: () => gates.isReconnecting,
          onNudge,
        });
      },
      { initialProps: { isBleConnection: () => true } },
    );
    addSpy.mockClear();

    rerender({ isBleConnection: () => true });

    expect(removeSpy).toHaveBeenCalledWith(
      'mesh-client:nobleBleYieldReleased',
      expect.any(Function),
    );
    expect(addSpy).toHaveBeenCalledWith('mesh-client:nobleBleYieldReleased', expect.any(Function));
    removeSpy.mockRestore();
    addSpy.mockRestore();
  });
});
