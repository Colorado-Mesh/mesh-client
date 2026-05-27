import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMeshcorePanelActions } from './useMeshcorePanelActions';

describe('useMeshcorePanelActions', () => {
  it('re-exports action callbacks from the injected device instance', () => {
    const signData = vi.fn();
    const device = {
      setConfig: vi.fn(),
      commitConfig: vi.fn(),
      setDeviceChannel: vi.fn(),
      clearChannel: vi.fn(),
      reboot: vi.fn(),
      shutdown: vi.fn(),
      factoryReset: vi.fn(),
      resetNodeDb: vi.fn(),
      sendPositionToDevice: vi.fn(),
      setOwner: vi.fn(),
      traceRoute: vi.fn(),
      refreshOurPosition: vi.fn(),
      sendWaypoint: vi.fn(),
      deleteWaypoint: vi.fn(),
      requestPosition: vi.fn(),
      importContacts: vi.fn(),
      refreshContacts: vi.fn(),
      sendAdvert: vi.fn(),
      syncClock: vi.fn(),
      setMeshcoreChannel: vi.fn(),
      deleteMeshcoreChannel: vi.fn(),
      applyMeshcoreContactAutoAdd: vi.fn(),
      applyMeshcoreTelemetryPrivacyPolicy: vi.fn(),
      getPickerStyleNodeLabel: vi.fn(),
      setRadioParams: vi.fn(),
      refreshMeshcoreAutoaddFromDevice: vi.fn(),
      clearAllMeshcoreContacts: vi.fn(),
      clearAllRepeaters: vi.fn(),
      requestRepeaterStatus: vi.fn(),
      requestNeighbors: vi.fn(),
      requestTelemetry: vi.fn(),
      sendRepeaterCliCommand: vi.fn(),
      clearCliHistory: vi.fn(),
      deleteNode: vi.fn(),
      setNodeFavorited: vi.fn(),
      clearRawPackets: vi.fn(),
      requestRefresh: vi.fn(),
      refreshNodesFromDb: vi.fn(),
      refreshMessagesFromDb: vi.fn(),
      getFullNodeLabel: vi.fn(),
      signData,
      exportPrivateKey: vi.fn(),
      importPrivateKey: vi.fn(),
    };

    const { result } = renderHook(() => useMeshcorePanelActions(device as never));

    expect(result.current.signData).toBe(signData);
    expect(result.current.importPrivateKey).toBe(device.importPrivateKey);
  });
});
