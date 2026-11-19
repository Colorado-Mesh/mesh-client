/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { BuiltinContactGroupFilterId } from '@/renderer/lib/contactGroupFilterIds';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import type { ContactGroup } from '../../shared/electron-api.types';

export type { BuiltinContactGroupFilterId };

export interface UseContactGroupsResult {
  groups: ContactGroup[];
  selectedGroupId: number | null;
  groupMemberIds: Set<number>;
  setSelectedGroupId: (id: number | null) => void;
  createGroup: (name: string) => Promise<number>;
  updateGroup: (groupId: number, name: string) => Promise<void>;
  deleteGroup: (groupId: number) => Promise<void>;
  addMember: (groupId: number, contactNodeId: number) => Promise<void>;
  removeMember: (groupId: number, contactNodeId: number) => Promise<void>;
  loadMembers: (groupId: number) => Promise<void>;
  reloadGroups: () => Promise<void>;
}

export function useContactGroups(
  selfNodeId: number | null,
  defaultSelectedGroupId: BuiltinContactGroupFilterId | null = null,
): UseContactGroupsResult {
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [selectedGroupId, setSelectedGroupIdState] = useState<number | null>(
    defaultSelectedGroupId,
  );
  const [groupMemberIds, setGroupMemberIds] = useState<Set<number>>(new Set());
  const selfNodeIdRef = useRef(selfNodeId);
  selfNodeIdRef.current = selfNodeId;
  const defaultSelectedGroupIdRef = useRef(defaultSelectedGroupId);
  defaultSelectedGroupIdRef.current = defaultSelectedGroupId;
  const loadedGroupIdRef = useRef<number | null>(null);
  const pendingGroupIdRef = useRef<number | null>(null);

  const reloadGroups = useCallback(async () => {
    const id = selfNodeIdRef.current;
    if (id == null || id <= 0) {
      setGroups([]);
      return;
    }
    try {
      const result = await window.electronAPI.db.getContactGroups(id);
      setGroups(result);
    } catch (e: unknown) {
      console.error('[useContactGroups] reloadGroups failed: ' + errLikeToLogString(e));
    }
  }, []);

  useEffect(() => {
    setGroups([]);
    setSelectedGroupIdState(defaultSelectedGroupId);
    setGroupMemberIds(new Set());
    // Drop in-flight member loads so a late response cannot repopulate after reset.
    pendingGroupIdRef.current = null;
    void reloadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfNodeId, defaultSelectedGroupId]);

  const setSelectedGroupId = useCallback((id: number | null) => {
    setSelectedGroupIdState(id);
    setGroupMemberIds(new Set());
    pendingGroupIdRef.current = id;
    if (id != null && id > 0) {
      window.electronAPI.db
        .getContactGroupMembers(id)
        .then((ids) => {
          if (pendingGroupIdRef.current === id) {
            setGroupMemberIds(new Set(ids));
          }
        })
        .catch((e: unknown) => {
          console.error(
            '[useContactGroups] getContactGroupMembers failed: ' + errLikeToLogString(e),
          );
        });
    }
  }, []);

  const loadMembers = useCallback(async (groupId: number) => {
    loadedGroupIdRef.current = groupId;
    const ids = await window.electronAPI.db.getContactGroupMembers(groupId);
    setGroupMemberIds(new Set(ids));
  }, []);

  const createGroup = useCallback(
    async (name: string): Promise<number> => {
      const id = selfNodeIdRef.current;
      if (id == null || id <= 0) throw new Error('No selfNodeId');
      const groupId = await window.electronAPI.db.createContactGroup(id, name);
      await reloadGroups();
      return groupId;
    },
    [reloadGroups],
  );

  const updateGroup = useCallback(
    async (groupId: number, name: string): Promise<void> => {
      await window.electronAPI.db.updateContactGroup(groupId, name);
      await reloadGroups();
    },
    [reloadGroups],
  );

  const deleteGroup = useCallback(
    async (groupId: number): Promise<void> => {
      await window.electronAPI.db.deleteContactGroup(groupId);
      setSelectedGroupIdState((prev) => {
        if (prev === groupId) {
          setGroupMemberIds(new Set());
          return defaultSelectedGroupIdRef.current;
        }
        return prev;
      });
      await reloadGroups();
    },
    [reloadGroups],
  );

  const addMember = useCallback(
    async (groupId: number, contactNodeId: number): Promise<void> => {
      await window.electronAPI.db.addContactToGroup(groupId, contactNodeId);
      setSelectedGroupIdState((prev) => {
        if (prev === groupId || loadedGroupIdRef.current === groupId) {
          setGroupMemberIds((ids) => new Set([...ids, contactNodeId]));
        }
        return prev;
      });
      await reloadGroups();
    },
    [reloadGroups],
  );

  const removeMember = useCallback(
    async (groupId: number, contactNodeId: number): Promise<void> => {
      await window.electronAPI.db.removeContactFromGroup(groupId, contactNodeId);
      setSelectedGroupIdState((prev) => {
        if (prev === groupId || loadedGroupIdRef.current === groupId) {
          setGroupMemberIds((ids) => {
            const next = new Set(ids);
            next.delete(contactNodeId);
            return next;
          });
        }
        return prev;
      });
      await reloadGroups();
    },
    [reloadGroups],
  );

  return {
    groups,
    selectedGroupId,
    groupMemberIds,
    setSelectedGroupId,
    createGroup,
    updateGroup,
    deleteGroup,
    addMember,
    removeMember,
    loadMembers,
    reloadGroups,
  };
}
