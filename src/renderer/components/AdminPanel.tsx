import { useCallback, useEffect, useRef, useState } from 'react';

import type { LocationFilter } from '../App';
import { haversineDistanceKm } from '../lib/nodeStatus';
import { parseStoredJson } from '../lib/parseStoredJson';
import type { MeshNode } from '../lib/types';
import { useToast } from './Toast';

// ─── Confirmation Modal ─────────────────────────────────────────
function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      {/* Modal */}
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        className="relative bg-deep-black border border-gray-600 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6 space-y-4"
      >
        <h3 id="confirm-title" className="text-lg font-semibold text-gray-200">
          {title}
        </h3>
        <p id="confirm-desc" className="text-sm text-muted leading-relaxed">
          {message}
        </p>
        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            aria-label="Cancel"
            className="flex-1 px-4 py-2.5 bg-secondary-dark hover:bg-gray-600 text-gray-300 font-medium rounded-lg transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            aria-label={confirmLabel}
            className={`flex-1 px-4 py-2.5 font-medium rounded-lg transition-colors text-sm text-white ${
              danger ? 'bg-red-600 hover:bg-red-500' : 'bg-yellow-600 hover:bg-yellow-500'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Admin Settings ─────────────────────────────────────────────
interface AdminSettings {
  autoPruneEnabled: boolean;
  autoPruneDays: number;
  nodeCapEnabled: boolean;
  nodeCapCount: number;
  distanceFilterEnabled: boolean;
  distanceFilterMax: number;
  distanceUnit: 'miles' | 'km';
  pruneEmptyNamesEnabled: boolean;
}

const DEFAULT_SETTINGS: AdminSettings = {
  autoPruneEnabled: false,
  autoPruneDays: 30,
  nodeCapEnabled: true,
  nodeCapCount: 10000,
  distanceFilterEnabled: false,
  distanceFilterMax: 500,
  distanceUnit: 'miles',
  pruneEmptyNamesEnabled: false,
};

function loadSettings(): AdminSettings {
  const parsed = parseStoredJson<Partial<AdminSettings>>(
    localStorage.getItem('mesh-client:adminSettings'),
    'AdminPanel loadSettings',
  );
  return parsed ? { ...DEFAULT_SETTINGS, ...parsed } : DEFAULT_SETTINGS;
}

interface Props {
  nodes: Map<number, MeshNode>;
  messageCount: number;
  channels: { index: number; name: string }[];
  onReboot: (seconds: number) => Promise<void>;
  onShutdown: (seconds: number) => Promise<void>;
  onFactoryReset: () => Promise<void>;
  onResetNodeDb: () => Promise<void>;
  isConnected: boolean;
  myNodeNum: number | null;
  onLocationFilterChange: (f: LocationFilter) => void;
}

interface PendingAction {
  name: string;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  action: () => Promise<void>;
}

export default function AdminPanel({
  nodes,
  messageCount,
  channels,
  onReboot,
  onShutdown,
  onFactoryReset,
  onResetNodeDb,
  isConnected,
  myNodeNum,
  onLocationFilterChange,
}: Props) {
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const { addToast } = useToast();

  // ─── Node retention settings ────────────────────────────────
  const [settings, setSettings] = useState<AdminSettings>(loadSettings);
  const [deleteAgeDays, setDeleteAgeDays] = useState(90);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      localStorage.setItem('mesh-client:adminSettings', JSON.stringify(settings));
    }, 300);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [settings]);

  useEffect(() => {
    const adminParsed = parseStoredJson<{ filterMqttOnly?: boolean }>(
      localStorage.getItem('mesh-client:adminSettings'),
      'AdminPanel hideMqttOnly from adminSettings',
    );
    const hideMqttOnly = adminParsed?.filterMqttOnly ?? false;
    onLocationFilterChange({
      enabled: settings.distanceFilterEnabled,
      maxDistance: settings.distanceFilterMax,
      unit: settings.distanceUnit,
      hideMqttOnly,
    });
  }, [
    settings.distanceFilterEnabled,
    settings.distanceFilterMax,
    settings.distanceUnit,
    onLocationFilterChange,
  ]);

  const updateSetting = <K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  // ─── Message channel selection ──────────────────────────────
  const [msgChannels, setMsgChannels] = useState<number[]>([]);
  const [clearChannelTarget, setClearChannelTarget] = useState<number>(-1);

  useEffect(() => {
    window.electronAPI.db
      .getMessageChannels()
      .then((rows) => {
        setMsgChannels(rows.map((r) => r.channel));
      })
      .catch((e) => {
        console.debug('[AdminPanel] getMessageChannels', e);
      });
  }, []);

  const getChannelLabel = useCallback(
    (ch: number) => {
      const named = channels.find((c) => c.index === ch);
      return named ? `Channel ${ch} — ${named.name}` : `Channel ${ch}`;
    },
    [channels],
  );

  // ─── Confirmation flow ──────────────────────────────────────
  const executeWithConfirmation = useCallback((action: PendingAction) => {
    setPendingAction(action);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pendingAction) return;
    setPendingAction(null);
    try {
      await pendingAction.action();
      addToast(`${pendingAction.name} completed successfully.`, 'success');
    } catch (err) {
      console.warn('[AdminPanel] pending action failed', err);
      addToast(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  }, [pendingAction, addToast]);

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h2 className="text-xl font-semibold text-gray-200">Administration</h2>

      {!isConnected && (
        <div className="bg-yellow-900/30 border border-yellow-700 text-yellow-300 px-4 py-2 rounded-lg text-sm">
          Connect to a device to use admin commands.
        </div>
      )}

      {/* Device Commands */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted">
          Device Commands (affects connected device)
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() =>
              executeWithConfirmation({
                name: 'Reboot',
                title: 'Reboot Device',
                message:
                  'This will reboot the connected Meshtastic device. It will briefly go offline during restart.',
                confirmLabel: 'Reboot',
                action: () => onReboot(2),
              })
            }
            disabled={!isConnected}
            className="px-4 py-3 bg-secondary-dark text-gray-300 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            Reboot
          </button>

          <button
            onClick={() =>
              executeWithConfirmation({
                name: 'Shutdown',
                title: 'Shutdown Device',
                message:
                  'This will power off the connected device. You will need to physically power it back on.',
                confirmLabel: 'Shutdown',
                action: () => onShutdown(2),
              })
            }
            disabled={!isConnected}
            className="px-4 py-3 bg-secondary-dark text-gray-300 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            Shutdown
          </button>

          <button
            onClick={() =>
              executeWithConfirmation({
                name: 'Reset NodeDB',
                title: 'Reset Node Database',
                message:
                  "This will clear the device's internal node database. The device will re-discover nodes over time.",
                confirmLabel: 'Reset NodeDB',
                action: () => onResetNodeDb(),
              })
            }
            disabled={!isConnected}
            className="px-4 py-3 bg-secondary-dark text-gray-300 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            Reset NodeDB
          </button>
        </div>
      </div>

      {/* Map & Node Filtering */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted">Map &amp; Node Filtering</h3>
        <div className="bg-secondary-dark rounded-lg p-4 space-y-4">
          <p className="text-xs text-muted leading-relaxed">
            Hides nodes beyond a set distance from your device. Filtering is display-only — nodes
            remain in the database.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="distanceFilter"
              checked={settings.distanceFilterEnabled}
              onChange={(e) => updateSetting('distanceFilterEnabled', e.target.checked)}
              className="accent-brand-green"
            />
            <label htmlFor="distanceFilter" className="text-sm text-gray-300 cursor-pointer">
              Filter distant nodes from map and node list
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-300">Max distance:</span>
            <input
              type="number"
              min={1}
              value={settings.distanceFilterMax}
              onChange={(e) =>
                updateSetting('distanceFilterMax', Math.max(1, parseInt(e.target.value) || 1))
              }
              disabled={!settings.distanceFilterEnabled}
              aria-label="Max distance"
              className="w-24 px-2 py-1 bg-deep-black border border-gray-600 rounded text-gray-200 text-sm text-right focus:border-brand-green focus:outline-none disabled:opacity-40"
            />
            <select
              value={settings.distanceUnit}
              onChange={(e) => updateSetting('distanceUnit', e.target.value as 'miles' | 'km')}
              disabled={!settings.distanceFilterEnabled}
              aria-label="Distance unit"
              className="px-2 py-1 bg-deep-black border border-gray-600 rounded text-gray-200 text-sm focus:border-brand-green focus:outline-none disabled:opacity-40"
            >
              <option value="miles">miles</option>
              <option value="km">km</option>
            </select>
          </div>
          {settings.distanceFilterEnabled &&
            (() => {
              const homeNode = myNodeNum != null ? nodes.get(myNodeNum) : undefined;
              const homeHasLocation =
                homeNode &&
                homeNode.latitude != null &&
                homeNode.latitude !== 0 &&
                homeNode.longitude != null &&
                homeNode.longitude !== 0;
              return !homeHasLocation ? (
                <p className="text-xs text-yellow-300 bg-yellow-900/30 border border-yellow-700 px-2 py-1.5 rounded">
                  Your device has no GPS fix — filter is enabled but all nodes are shown.
                </p>
              ) : null;
            })()}
          <p className="text-xs text-muted">Note: Requires your device to have a valid GPS fix.</p>
        </div>
      </div>

      {/* Node Retention */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted">Node Retention</h3>
        <div className="bg-secondary-dark rounded-lg p-4 space-y-4">
          {/* Manual age delete */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-300 flex-1">Delete nodes last heard more than</span>
            <input
              type="number"
              min={1}
              value={deleteAgeDays}
              onChange={(e) => setDeleteAgeDays(Math.max(1, parseInt(e.target.value) || 1))}
              aria-label="Delete nodes older than (days)"
              className="w-20 px-2 py-1 bg-deep-black border border-gray-600 rounded text-gray-200 text-sm text-right focus:border-brand-green focus:outline-none"
            />
            <span className="text-sm text-gray-300">days ago</span>
            <button
              onClick={() =>
                executeWithConfirmation({
                  name: 'Delete Old Nodes',
                  title: 'Delete Old Nodes',
                  message: `This will permanently delete all nodes that haven't been heard in the last ${deleteAgeDays} day${deleteAgeDays !== 1 ? 's' : ''}. They will be re-discovered when they broadcast again.`,
                  confirmLabel: 'Delete Old Nodes',
                  danger: true,
                  action: async () => {
                    await window.electronAPI.db.deleteNodesByAge(deleteAgeDays);
                  },
                })
              }
              className="px-3 py-1.5 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded text-sm font-medium transition-colors whitespace-nowrap"
            >
              Delete Old Nodes
            </button>
          </div>

          {/* Auto-prune on startup */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="autoPrune"
              checked={settings.autoPruneEnabled}
              onChange={(e) => updateSetting('autoPruneEnabled', e.target.checked)}
              className="accent-brand-green"
            />
            <label htmlFor="autoPrune" className="text-sm text-gray-300 flex-1 cursor-pointer">
              Auto-prune on startup, older than
            </label>
            <input
              type="number"
              min={1}
              value={settings.autoPruneDays}
              onChange={(e) =>
                updateSetting('autoPruneDays', Math.max(1, parseInt(e.target.value) || 1))
              }
              disabled={!settings.autoPruneEnabled}
              aria-label="Auto-prune age (days)"
              className="w-20 px-2 py-1 bg-deep-black border border-gray-600 rounded text-gray-200 text-sm text-right focus:border-brand-green focus:outline-none disabled:opacity-40"
            />
            <span className="text-sm text-gray-300">days</span>
          </div>

          {/* Delete unnamed nodes */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-300 flex-1">Delete nodes with no name</span>
            <button
              onClick={() =>
                executeWithConfirmation({
                  name: 'Delete Unnamed Nodes',
                  title: 'Delete Unnamed Nodes',
                  message:
                    'This will permanently delete all nodes that have no long name set. They will be re-discovered when they broadcast again.',
                  confirmLabel: 'Delete Unnamed Nodes',
                  danger: true,
                  action: async () => {
                    await window.electronAPI.db.deleteNodesWithoutLongname();
                  },
                })
              }
              className="px-3 py-1.5 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded text-sm font-medium transition-colors whitespace-nowrap"
            >
              Delete Unnamed Nodes
            </button>
          </div>

          {/* Auto-prune unnamed nodes on startup */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="pruneEmptyNames"
              checked={settings.pruneEmptyNamesEnabled}
              onChange={(e) => updateSetting('pruneEmptyNamesEnabled', e.target.checked)}
              className="accent-brand-green"
            />
            <label
              htmlFor="pruneEmptyNames"
              className="text-sm text-gray-300 flex-1 cursor-pointer"
            >
              Auto-prune unnamed nodes on startup
            </label>
          </div>

          {/* Node cap */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="nodeCap"
              checked={settings.nodeCapEnabled}
              onChange={(e) => updateSetting('nodeCapEnabled', e.target.checked)}
              className="accent-brand-green"
            />
            <label htmlFor="nodeCap" className="text-sm text-gray-300 flex-1 cursor-pointer">
              Cap total nodes, keep newest
            </label>
            <input
              type="number"
              min={1}
              value={settings.nodeCapCount}
              onChange={(e) =>
                updateSetting('nodeCapCount', Math.max(1, parseInt(e.target.value) || 1))
              }
              disabled={!settings.nodeCapEnabled}
              aria-label="Maximum node count"
              className="w-24 px-2 py-1 bg-deep-black border border-gray-600 rounded text-gray-200 text-sm text-right focus:border-brand-green focus:outline-none disabled:opacity-40"
            />
            <span className="text-sm text-gray-300">nodes</span>
          </div>

          {/* Clear all nodes */}
          <div className="pt-1 border-t border-gray-700">
            <button
              onClick={() =>
                executeWithConfirmation({
                  name: 'Clear Nodes',
                  title: 'Clear Nodes',
                  message: `This will permanently delete all ${nodes.size} locally stored nodes. They will be re-discovered when connected.`,
                  confirmLabel: `Clear ${nodes.size} Nodes`,
                  danger: true,
                  action: async () => {
                    await window.electronAPI.db.clearNodes();
                  },
                })
              }
              className="w-full px-4 py-2.5 bg-secondary-dark text-gray-300 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
            >
              Clear All Nodes ({nodes.size})
            </button>
          </div>
        </div>
      </div>

      {/* Prune by Location */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted">Prune by Location</h3>
        <div className="bg-secondary-dark rounded-lg p-4 space-y-4">
          <p className="text-xs text-muted leading-relaxed">
            Permanently deletes nodes from the database. This cannot be undone.
          </p>
          <div className="space-y-2">
            <button
              onClick={() => {
                const zeroIslandNodes = Array.from(nodes.values()).filter(
                  (n) => Math.abs(n.latitude ?? 0) < 0.5 && Math.abs(n.longitude ?? 0) < 0.5,
                );
                if (zeroIslandNodes.length === 0) {
                  addToast('No zero/null island nodes found.', 'success');
                  return;
                }
                executeWithConfirmation({
                  name: 'Prune Zero Island Nodes',
                  title: 'Prune Zero/Null Island Nodes',
                  message: `This will permanently delete ${zeroIslandNodes.length} node${zeroIslandNodes.length !== 1 ? 's' : ''} with coordinates at or near 0°N, 0°E (invalid GPS). This cannot be undone.`,
                  confirmLabel: `Delete ${zeroIslandNodes.length} Node${zeroIslandNodes.length !== 1 ? 's' : ''}`,
                  danger: true,
                  action: async () => {
                    await window.electronAPI.db.deleteNodesBatch(
                      zeroIslandNodes.map((n) => n.node_id),
                    );
                  },
                });
              }}
              className="w-full px-4 py-2.5 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded-lg text-sm font-medium transition-colors text-left"
            >
              <div className="font-medium">Prune Zero/Null Island Nodes</div>
              <div className="text-xs text-red-400/70 mt-0.5">
                Removes nodes with coordinates at or near 0°N, 0°E (invalid GPS).
              </div>
            </button>
            <button
              onClick={() => {
                const homeNode = myNodeNum != null ? nodes.get(myNodeNum) : undefined;
                if (
                  !homeNode ||
                  homeNode.latitude == null ||
                  homeNode.longitude == null ||
                  (homeNode.latitude === 0 && homeNode.longitude === 0)
                ) {
                  addToast('Your device has no GPS coordinates.', 'error');
                  return;
                }
                const maxKm =
                  settings.distanceUnit === 'miles'
                    ? settings.distanceFilterMax * 1.60934
                    : settings.distanceFilterMax;
                const distantNodes = Array.from(nodes.values()).filter((n) => {
                  if (n.node_id === myNodeNum) return false;
                  if (n.latitude == null || n.longitude == null) return false;
                  const d = haversineDistanceKm(
                    homeNode.latitude!,
                    homeNode.longitude!,
                    n.latitude,
                    n.longitude,
                  );
                  return d > maxKm;
                });
                if (distantNodes.length === 0) {
                  addToast('No nodes found beyond the distance threshold.', 'success');
                  return;
                }
                executeWithConfirmation({
                  name: 'Prune Distant Nodes',
                  title: 'Prune Distant Nodes',
                  message: `This will permanently delete ${distantNodes.length} node${distantNodes.length !== 1 ? 's' : ''} beyond ${settings.distanceFilterMax} ${settings.distanceUnit} from your device. This cannot be undone.`,
                  confirmLabel: `Delete ${distantNodes.length} Node${distantNodes.length !== 1 ? 's' : ''}`,
                  danger: true,
                  action: async () => {
                    await window.electronAPI.db.deleteNodesBatch(
                      distantNodes.map((n) => n.node_id),
                    );
                  },
                });
              }}
              className="w-full px-4 py-2.5 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded-lg text-sm font-medium transition-colors text-left"
            >
              <div className="font-medium">Prune Distant Nodes</div>
              <div className="text-xs text-red-400/70 mt-0.5">
                Removes nodes beyond the distance threshold above. Requires your device to have a
                valid GPS location.
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Data Management */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted">Data Management</h3>
        <p className="text-xs text-muted">
          Export your local database (messages &amp; nodes) as a .db file, or import/merge another
          user's database into yours.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={async () => {
              try {
                const path = await window.electronAPI.db.exportDb();
                if (path) {
                  addToast(`Exported to: ${path}`, 'success');
                }
              } catch (err) {
                console.warn('[AdminPanel] export failed', err);
                addToast(
                  `Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                  'error',
                );
              }
            }}
            className="px-4 py-3 bg-secondary-dark text-gray-300 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
          >
            Export Database
          </button>

          <button
            onClick={async () => {
              try {
                const result = await window.electronAPI.db.importDb();
                if (result) {
                  addToast(
                    `Merged: ${result.nodesAdded} new nodes, ${result.messagesAdded} new messages.`,
                    'success',
                  );
                }
              } catch (err) {
                console.warn('[AdminPanel] import failed', err);
                addToast(
                  `Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                  'error',
                );
              }
            }}
            className="px-4 py-3 bg-secondary-dark text-gray-300 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
          >
            Import &amp; Merge
          </button>
        </div>
      </div>

      {/* Message Management */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted">Message Management</h3>

        {/* Channel-scoped message deletion */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">Channel:</label>
            <select
              value={clearChannelTarget}
              onChange={(e) => setClearChannelTarget(parseInt(e.target.value))}
              aria-label="Select channel to clear"
              className="flex-1 px-3 py-1.5 bg-secondary-dark border border-gray-600 rounded-lg text-gray-200 text-sm focus:border-brand-green focus:outline-none"
            >
              <option value={-1}>All Channels</option>
              {msgChannels.map((ch) => (
                <option key={ch} value={ch}>
                  {getChannelLabel(ch)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={() => {
            const isAll = clearChannelTarget === -1;
            const channelName = isAll ? '' : getChannelLabel(clearChannelTarget);
            executeWithConfirmation({
              name: 'Clear Messages',
              title: 'Clear Messages',
              message: isAll
                ? `This will permanently delete all ${messageCount} locally stored messages across all channels. This cannot be undone.`
                : `This will permanently delete all messages from ${channelName}. This cannot be undone.`,
              confirmLabel: isAll ? `Clear ${messageCount} Messages` : `Clear ${channelName}`,
              danger: true,
              action: async () => {
                if (isAll) {
                  await window.electronAPI.db.clearMessages();
                } else {
                  await window.electronAPI.db.clearMessagesByChannel(clearChannelTarget);
                }
              },
            });
          }}
          className="w-full px-4 py-3 bg-secondary-dark text-gray-300 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
        >
          Clear Messages ({messageCount})
        </button>
      </div>

      {/* Danger Zone */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-red-400">Danger Zone</h3>
        <div className="border border-red-900 rounded-lg p-4 space-y-2">
          <p className="text-xs text-red-400/80">
            These actions are permanent and cannot be undone.
          </p>
          <button
            onClick={() =>
              executeWithConfirmation({
                name: 'Clear All Data',
                title: '⚠ Clear All Local Data',
                message:
                  'This will permanently delete ALL local messages, nodes, and cached session data. This action CANNOT be undone.',
                confirmLabel: 'Clear Everything',
                danger: true,
                action: async () => {
                  await window.electronAPI.db.clearMessages();
                  await window.electronAPI.db.clearNodes();
                  await window.electronAPI.clearSessionData();
                },
              })
            }
            className="w-full px-4 py-3 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded-lg text-sm font-medium transition-colors"
          >
            Clear All Local Data &amp; Cache
          </button>
          <button
            onClick={() =>
              executeWithConfirmation({
                name: 'Factory Reset',
                title: '⚠ Factory Reset',
                message:
                  'This will erase ALL device settings and restore factory defaults. All channels, configuration, and stored data on the device will be permanently lost. This action CANNOT be undone.',
                confirmLabel: 'Factory Reset',
                danger: true,
                action: () => onFactoryReset(),
              })
            }
            disabled={!isConnected}
            className="w-full px-4 py-3 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            Factory Reset Device
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {pendingAction && (
        <ConfirmModal
          title={pendingAction.title}
          message={pendingAction.message}
          confirmLabel={pendingAction.confirmLabel}
          danger={pendingAction.danger}
          onConfirm={handleConfirm}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
