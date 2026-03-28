import { useEffect, useRef, useState } from 'react';

import type { ContactGroup } from '../../shared/electron-api.types';
import type { MeshNode } from '../lib/types';

interface ContactGroupsModalProps {
  groups: ContactGroup[];
  contacts: Map<number, MeshNode>;
  onClose: () => void;
  onCreate: (name: string) => Promise<number>;
  onRename: (groupId: number, name: string) => Promise<void>;
  onDelete: (groupId: number) => Promise<void>;
  onAddMember: (groupId: number, contactNodeId: number) => Promise<void>;
  onRemoveMember: (groupId: number, contactNodeId: number) => Promise<void>;
  onLoadMembers: (groupId: number) => Promise<void>;
  memberIds: Set<number>;
}

export default function ContactGroupsModal({
  groups,
  contacts,
  onClose,
  onCreate,
  onRename,
  onDelete,
  onAddMember,
  onRemoveMember,
  onLoadMembers,
  memberIds,
}: ContactGroupsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Group list state
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Member management view
  const [managingGroup, setManagingGroup] = useState<ContactGroup | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (managingGroup) {
          setManagingGroup(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose, managingGroup]);

  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ),
    ).filter((el) => el.offsetParent !== null || root.contains(el));
    if (focusables.length > 0) focusables[0].focus();
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onTab);
    return () => {
      root.removeEventListener('keydown', onTab);
    };
  }, [managingGroup]);

  async function handleCreate() {
    const name = newGroupName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onCreate(name);
      setNewGroupName('');
    } finally {
      setBusy(false);
    }
  }

  async function handleRenameSubmit(groupId: number) {
    const name = editingName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onRename(groupId, name);
      setEditingGroupId(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(groupId: number) {
    if (busy) return;
    setBusy(true);
    try {
      await onDelete(groupId);
      setDeleteConfirmId(null);
      if (managingGroup?.group_id === groupId) setManagingGroup(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenMembers(group: ContactGroup) {
    await onLoadMembers(group.group_id);
    setManagingGroup(group);
  }

  async function handleToggleMember(contactNodeId: number) {
    if (!managingGroup || busy) return;
    setBusy(true);
    try {
      if (memberIds.has(contactNodeId)) {
        await onRemoveMember(managingGroup.group_id, contactNodeId);
      } else {
        await onAddMember(managingGroup.group_id, contactNodeId);
      }
    } finally {
      setBusy(false);
    }
  }

  const sortedContacts = Array.from(contacts.values()).sort((a, b) =>
    (a.long_name || '').localeCompare(b.long_name || ''),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm cursor-pointer border-0 p-0"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="groups-modal-title"
        className="relative z-10 bg-deep-black border border-gray-700 rounded-xl max-w-lg w-full shadow-2xl flex flex-col max-h-[80vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          {managingGroup ? (
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => {
                  setManagingGroup(null);
                }}
                aria-label="Back to groups"
                className="p-1 rounded hover:bg-secondary-dark text-muted hover:text-gray-200 transition-colors shrink-0"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 id="groups-modal-title" className="text-lg font-semibold text-gray-100 truncate">
                {managingGroup.name}
              </h2>
            </div>
          ) : (
            <h2 id="groups-modal-title" className="text-lg font-semibold text-gray-100">
              Contact Groups
            </h2>
          )}
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg hover:bg-secondary-dark text-muted hover:text-gray-200 transition-colors shrink-0"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-3">
          {managingGroup ? (
            /* Member management view */
            <>
              <p className="text-xs text-muted">
                {memberIds.size} member{memberIds.size !== 1 ? 's' : ''}
              </p>
              {sortedContacts.length === 0 ? (
                <p className="text-sm text-muted">No contacts yet.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {sortedContacts.map((contact) => (
                    <li key={contact.node_id}>
                      <label className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-secondary-dark/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={memberIds.has(contact.node_id)}
                          onChange={() => void handleToggleMember(contact.node_id)}
                          disabled={busy}
                          className="accent-brand-green"
                        />
                        <span className="text-sm text-gray-200 truncate">{contact.long_name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            /* Group list view */
            <>
              {/* Create new group */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => {
                    setNewGroupName(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreate();
                  }}
                  placeholder="New group name…"
                  maxLength={100}
                  disabled={busy}
                  className="flex-1 px-3 py-1.5 bg-secondary-dark/80 rounded-lg text-gray-200 text-sm border border-gray-600/50 focus:border-brand-green/50 focus:outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={!newGroupName.trim() || busy}
                  className="px-3 py-1.5 rounded-lg bg-brand-green/20 text-brand-green text-sm font-medium hover:bg-brand-green/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>

              {/* Group list */}
              {groups.length === 0 ? (
                <p className="text-sm text-muted">No groups yet. Create one above.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {groups.map((group) => (
                    <li
                      key={group.group_id}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-secondary-dark/30"
                    >
                      {editingGroupId === group.group_id ? (
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => {
                            setEditingName(e.target.value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleRenameSubmit(group.group_id);
                            if (e.key === 'Escape') setEditingGroupId(null);
                          }}
                          maxLength={100}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          disabled={busy}
                          className="flex-1 px-2 py-1 bg-secondary-dark rounded text-gray-200 text-sm border border-brand-green/50 focus:outline-none disabled:opacity-50"
                        />
                      ) : (
                        <span className="flex-1 text-sm text-gray-200 truncate">
                          {group.name}
                          <span className="ml-1.5 text-xs text-muted">({group.member_count})</span>
                        </span>
                      )}

                      {editingGroupId === group.group_id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleRenameSubmit(group.group_id)}
                            disabled={!editingName.trim() || busy}
                            aria-label="Save name"
                            className="p-1 rounded hover:bg-secondary-dark text-brand-green transition-colors disabled:opacity-40"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingGroupId(null);
                            }}
                            aria-label="Cancel rename"
                            className="p-1 rounded hover:bg-secondary-dark text-muted hover:text-gray-200 transition-colors"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleOpenMembers(group)}
                            aria-label={`Manage members of ${group.name}`}
                            title="Manage members"
                            className="p-1 rounded hover:bg-secondary-dark text-muted hover:text-gray-200 transition-colors"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingGroupId(group.group_id);
                              setEditingName(group.name);
                            }}
                            aria-label={`Rename ${group.name}`}
                            title="Rename"
                            className="p-1 rounded hover:bg-secondary-dark text-muted hover:text-gray-200 transition-colors"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                              />
                            </svg>
                          </button>
                          {deleteConfirmId === group.group_id ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleDelete(group.group_id)}
                                disabled={busy}
                                aria-label="Confirm delete"
                                className="px-2 py-0.5 rounded text-xs bg-red-600/30 text-red-400 hover:bg-red-600/50 transition-colors disabled:opacity-40"
                              >
                                Delete?
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteConfirmId(null);
                                }}
                                aria-label="Cancel delete"
                                className="p-1 rounded hover:bg-secondary-dark text-muted hover:text-gray-200 transition-colors"
                              >
                                <svg
                                  className="w-4 h-4"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M6 18L18 6M6 6l12 12"
                                  />
                                </svg>
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteConfirmId(group.group_id);
                              }}
                              aria-label={`Delete ${group.name}`}
                              title="Delete group"
                              className="p-1 rounded hover:bg-secondary-dark text-muted hover:text-red-400 transition-colors"
                            >
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
