import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMeshtasticPanelActions } from './useMeshtasticPanelActions';

describe('useMeshtasticPanelActions', () => {
  it('re-exports action callbacks from the injected device instance', () => {
    const setConfig = vi.fn();
    const sendReaction = vi.fn();
    const device = {
      setConfig,
      commitConfig: vi.fn(),
      setDeviceChannel: vi.fn(),
      clearChannel: vi.fn(),
      applyChannelSet: vi.fn(),
      reboot: vi.fn(),
      shutdown: vi.fn(),
      factoryReset: vi.fn(),
      resetNodeDb: vi.fn(),
      sendPositionToDevice: vi.fn(),
      setOwner: vi.fn(),
      rebootOta: vi.fn(),
      enterDfuMode: vi.fn(),
      factoryResetConfig: vi.fn(),
      traceRoute: vi.fn(),
      setConfigureTargetNodeNum: vi.fn(),
      refreshRemoteConfigSnapshot: vi.fn(),
      getRemoteAdminSessionStatus: vi.fn(),
      getNodeName: vi.fn(),
      getPickerStyleNodeLabel: vi.fn(),
      refreshOurPosition: vi.fn(),
      sendWaypoint: vi.fn(),
      deleteWaypoint: vi.fn(),
      requestPosition: vi.fn(),
      setModuleConfig: vi.fn(),
      setCannedMessages: vi.fn(),
      setRingtone: vi.fn(),
      getNodes: vi.fn(),
      sendReaction,
      requestStoreForwardHistory: vi.fn(),
      requestRefresh: vi.fn(),
      setNodeFavorited: vi.fn(),
      deleteNode: vi.fn(),
      clearRawPackets: vi.fn(),
      refreshNodesFromDb: vi.fn(),
      refreshMessagesFromDb: vi.fn(),
      getFullNodeLabel: vi.fn(),
    };

    const { result } = renderHook(() => useMeshtasticPanelActions(device as never));

    expect(result.current.setConfig).toBe(setConfig);
    expect(result.current.sendReaction).toBe(sendReaction);
    expect(result.current.refreshNodesFromDb).toBe(device.refreshNodesFromDb);
    expect(result.current.getFullNodeLabel).toBe(device.getFullNodeLabel);
  });
});
