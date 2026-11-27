// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MeshcomRuntime } from '../runtime/useMeshcomRuntime';
import { useMeshcomPanelActions } from './useMeshcomPanelActions';

function fakeRuntime(overrides: Partial<MeshcomRuntime> = {}): MeshcomRuntime {
  return {
    getFullNodeLabel: vi.fn(),
    getPickerStyleNodeLabel: vi.fn(),
    refreshNodesFromDb: vi.fn(),
    refreshMessagesFromDb: vi.fn(),
    requestRefresh: vi.fn(),
    refreshOurPosition: vi.fn(),
    setOwner: vi.fn(),
    sendPositionToDevice: vi.fn(),
    setNodeFavorited: vi.fn(),
    deleteNode: vi.fn(),
    sendReaction: vi.fn(),
    clearRawPackets: vi.fn(),
    hydrateRawPackets: vi.fn(),
    importContacts: vi.fn(),
    deviceCommands: {} as MeshcomRuntime['deviceCommands'],
    ...overrides,
  } as MeshcomRuntime;
}

describe('useMeshcomPanelActions', () => {
  it('refreshes setNodeFavorited when the runtime callback identity changes', () => {
    const firstFav = vi.fn();
    const secondFav = vi.fn();
    const runtime = fakeRuntime({ setNodeFavorited: firstFav });

    const { result, rerender } = renderHook(
      ({ rt }: { rt: MeshcomRuntime }) => useMeshcomPanelActions(rt),
      { initialProps: { rt: runtime } },
    );
    expect(result.current.setNodeFavorited).toBe(firstFav);

    // Same runtime object identity (MQTT / nodes churn used to pin a stale memo on `[runtime]`
    // alone when the outer object was reused) — callback field replaced in place.
    runtime.setNodeFavorited = secondFav;
    rerender({ rt: runtime });
    expect(result.current.setNodeFavorited).toBe(secondFav);
  });
});
