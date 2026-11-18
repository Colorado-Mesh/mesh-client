import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MESHCORE_BUILTIN_CONTACT_TYPE_CHAT } from '../lib/meshcoreContactGroupUtils';
import { useContactGroups } from './useContactGroups';

describe('useContactGroups', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.db.getContactGroups).mockReset();
    vi.mocked(window.electronAPI.db.getContactGroups).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.deleteContactGroup).mockReset();
    vi.mocked(window.electronAPI.db.deleteContactGroup).mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.db.getContactGroupMembers).mockReset();
    vi.mocked(window.electronAPI.db.getContactGroupMembers).mockResolvedValue([]);
  });

  it('defaults selectedGroupId to null when no default is passed', () => {
    const { result } = renderHook(() => useContactGroups(1));
    expect(result.current.selectedGroupId).toBeNull();
  });

  it('defaults selectedGroupId to MeshCore Chat type when provided', () => {
    const { result } = renderHook(() => useContactGroups(1, MESHCORE_BUILTIN_CONTACT_TYPE_CHAT));
    expect(result.current.selectedGroupId).toBe(MESHCORE_BUILTIN_CONTACT_TYPE_CHAT);
  });

  it('resets to defaultSelectedGroupId when selfNodeId changes', async () => {
    const { result, rerender } = renderHook(
      ({ selfId, defaultId }: { selfId: number | null; defaultId: number | null }) =>
        useContactGroups(selfId, defaultId),
      {
        initialProps: {
          selfId: 1,
          defaultId: MESHCORE_BUILTIN_CONTACT_TYPE_CHAT,
        },
      },
    );

    act(() => {
      result.current.setSelectedGroupId(null);
    });
    expect(result.current.selectedGroupId).toBeNull();

    rerender({ selfId: 2, defaultId: MESHCORE_BUILTIN_CONTACT_TYPE_CHAT });
    await waitFor(() => {
      expect(result.current.selectedGroupId).toBe(MESHCORE_BUILTIN_CONTACT_TYPE_CHAT);
    });
  });

  it('resets to defaultSelectedGroupId when protocol default changes', async () => {
    interface Props {
      selfId: number | null;
      defaultId: number | null;
    }
    const initialProps: Props = {
      selfId: 1,
      defaultId: MESHCORE_BUILTIN_CONTACT_TYPE_CHAT,
    };
    const { result, rerender } = renderHook(
      ({ selfId, defaultId }: Props) => useContactGroups(selfId, defaultId),
      { initialProps },
    );
    expect(result.current.selectedGroupId).toBe(MESHCORE_BUILTIN_CONTACT_TYPE_CHAT);

    rerender({ selfId: 1, defaultId: null });
    await waitFor(() => {
      expect(result.current.selectedGroupId).toBeNull();
    });
  });

  it('returns to defaultSelectedGroupId after deleting the selected custom group', async () => {
    vi.mocked(window.electronAPI.db.getContactGroups).mockResolvedValue([
      { group_id: 42, name: 'Team', member_count: 0 },
    ]);

    const { result } = renderHook(() => useContactGroups(1, MESHCORE_BUILTIN_CONTACT_TYPE_CHAT));

    await waitFor(() => {
      expect(result.current.groups).toHaveLength(1);
    });

    act(() => {
      result.current.setSelectedGroupId(42);
    });
    expect(result.current.selectedGroupId).toBe(42);

    await act(async () => {
      await result.current.deleteGroup(42);
    });

    expect(result.current.selectedGroupId).toBe(MESHCORE_BUILTIN_CONTACT_TYPE_CHAT);
    expect(window.electronAPI.db.deleteContactGroup).toHaveBeenCalledWith(42);
  });
});
