import { useState, useMemo } from "react";
import type { MeshNode } from "../lib/types";
import { getNodeStatus, haversineDistanceKm } from "../lib/nodeStatus";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { RoleDisplay } from "../lib/roleInfo";
import RefreshButton from "./RefreshButton";
import SignalBars from "./SignalBars";
import type { LocationFilter } from "../App";

type SortField =
  | "node_id"
  | "long_name"
  | "short_name"
  | "rssi"
  | "battery"
  | "last_heard"
  | "latitude"
  | "longitude"
  | "role"
  | "hops_away"
  | "via_mqtt"
  | "voltage"
  | "channel_utilization"
  | "air_util_tx"
  | "altitude";

interface Props {
  nodes: Map<number, MeshNode>;
  myNodeNum: number;
  onRefresh: () => Promise<void>;
  onNodeClick: (node: MeshNode) => void;
  isConnected: boolean;
  locationFilter: LocationFilter;
  onToggleFavorite: (nodeId: number, favorited: boolean) => void;
}

export default function NodeListPanel({
  nodes,
  myNodeNum,
  onRefresh,
  onNodeClick,
  isConnected,
  locationFilter,
  onToggleFavorite,
}: Props) {
  const anomalies = useDiagnosticsStore((s) => s.anomalies);
  const ignoreMqttEnabled = useDiagnosticsStore((s) => s.ignoreMqttEnabled);
  const [sortField, setSortField] = useState<SortField>("last_heard");
  const [sortAsc, setSortAsc] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(field === "long_name" || field === "short_name"); // text asc, numbers desc
    }
  };

  const nodeList = useMemo(() => {
    let list = Array.from(nodes.values());

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (n) =>
          n.long_name.toLowerCase().includes(q) ||
          n.short_name.toLowerCase().includes(q) ||
          n.node_id.toString(16).includes(q)
      );
    }

    // Filter MQTT-only nodes
    if (locationFilter.hideMqttOnly) {
      list = list.filter((n) => !n.heard_via_mqtt_only);
    }

    // Filter by distance
    if (locationFilter.enabled) {
      const homeNode = myNodeNum ? nodes.get(myNodeNum) : undefined;
      const homeHasLocation = homeNode &&
        homeNode.latitude != null && homeNode.latitude !== 0 &&
        homeNode.longitude != null && homeNode.longitude !== 0;
      if (homeHasLocation) {
        const maxKm = locationFilter.unit === "miles"
          ? locationFilter.maxDistance * 1.60934
          : locationFilter.maxDistance;
        list = list.filter((n) => {
          if (n.node_id === myNodeNum) return true;
          // Nodes without GPS can't be distance-filtered — keep them visible
          if (!n.latitude && !n.longitude) return true;
          const d = haversineDistanceKm(homeNode!.latitude, homeNode!.longitude, n.latitude, n.longitude);
          return d <= maxKm;
        });
      }
    }

    // Sort
    list.sort((a, b) => {
      // Self-node always first
      if (a.node_id === myNodeNum) return -1;
      if (b.node_id === myNodeNum) return 1;
      // Favorites pinned above non-favorites
      const aFav = a.favorited ? 1 : 0;
      const bFav = b.favorited ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      // Regular field sort
      let cmp = 0;
      switch (sortField) {
        case "node_id":
          cmp = a.node_id - b.node_id;
          break;
        case "long_name":
          cmp = (a.long_name || "").localeCompare(b.long_name || "");
          break;
        case "short_name":
          cmp = (a.short_name || "").localeCompare(b.short_name || "");
          break;
        case "rssi":
          cmp = (a.rssi ?? -999) - (b.rssi ?? -999);
          break;
        case "battery":
          cmp = (a.battery || 0) - (b.battery || 0);
          break;
        case "last_heard":
          cmp = (a.last_heard || 0) - (b.last_heard || 0);
          break;
        case "latitude":
          cmp = (a.latitude || 0) - (b.latitude || 0);
          break;
        case "longitude":
          cmp = (a.longitude || 0) - (b.longitude || 0);
          break;
        case "role":
          cmp = (a.role ?? 999) - (b.role ?? 999);
          break;
        case "hops_away":
          cmp = (a.hops_away ?? 999) - (b.hops_away ?? 999);
          break;
        case "via_mqtt": {
          const aVal = a.heard_via_mqtt_only ? 2 : (a.via_mqtt ? 1 : 0);
          const bVal = b.heard_via_mqtt_only ? 2 : (b.via_mqtt ? 1 : 0);
          cmp = aVal - bVal;
          break;
        }
        case "voltage":
          cmp = (a.voltage ?? 0) - (b.voltage ?? 0);
          break;
        case "channel_utilization":
          cmp = (a.channel_utilization ?? 0) - (b.channel_utilization ?? 0);
          break;
        case "air_util_tx":
          cmp = (a.air_util_tx ?? 0) - (b.air_util_tx ?? 0);
          break;
        case "altitude":
          cmp = (a.altitude ?? 0) - (b.altitude ?? 0);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });

    return list;
  }, [nodes, sortField, sortAsc, searchQuery, myNodeNum, locationFilter]);

  const filterStatus = useMemo(() => {
    if (!locationFilter.enabled) return null;
    const homeNode = myNodeNum ? nodes.get(myNodeNum) : undefined;
    const homeHasLocation = homeNode &&
      homeNode.latitude != null && homeNode.latitude !== 0 &&
      homeNode.longitude != null && homeNode.longitude !== 0;
    if (!homeHasLocation) return "no-gps";
    const totalWithGps = Array.from(nodes.values()).filter(
      (n) => n.node_id !== myNodeNum && (n.latitude || n.longitude)
    ).length;
    const visibleWithGps = nodeList.filter(
      (n) => n.node_id !== myNodeNum && (n.latitude || n.longitude)
    ).length;
    return { hidden: totalWithGps - visibleWithGps };
  }, [locationFilter, myNodeNum, nodes, nodeList]);

  function formatTime(ts: number): string {
    if (!ts) return "Never";
    const diff = Date.now() - ts;
    if (diff < 60_000) return "Just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(ts).toLocaleDateString();
  }

  function formatCoord(val: number): string {
    return val === 0 ? "-" : val.toFixed(4);
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return (
        <svg className="w-3 h-3 text-gray-600 ml-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return (
      <svg className="w-3 h-3 text-bright-green ml-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d={sortAsc ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"}
        />
      </svg>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center gap-3">
        <h2 className="text-xl font-semibold text-gray-200">
          Node Database ({nodeList.length})
        </h2>
        <div className="flex items-center gap-2 flex-1 max-w-xs">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search nodes..."
            className="flex-1 px-3 py-1.5 bg-secondary-dark/80 rounded-lg text-gray-200 text-sm border border-gray-600/50 focus:border-brand-green/50 focus:outline-none"
          />
        </div>
        <RefreshButton onRefresh={onRefresh} disabled={!isConnected} />
      </div>

      {/* Distance filter status */}
      {filterStatus === "no-gps" && (
        <div className="bg-yellow-900/30 border border-yellow-700 text-yellow-300 px-3 py-2 rounded-lg text-xs">
          Distance filter is enabled but your device has no GPS fix — all nodes are shown.
        </div>
      )}
      {filterStatus !== null && filterStatus !== "no-gps" && filterStatus.hidden > 0 && (
        <div className="bg-brand-green/10 border border-brand-green/30 text-brand-green px-3 py-2 rounded-lg text-xs">
          Distance filter active — {filterStatus.hidden} node{filterStatus.hidden !== 1 ? "s" : ""} hidden beyond {locationFilter.maxDistance} {locationFilter.unit}.
        </div>
      )}

      {/* Online / Stale / Offline summary */}
      <div className="flex gap-3 text-xs text-muted">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-brand-green inline-block" />
          {nodeList.filter((n) => getNodeStatus(n.last_heard) === "online").length} online
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />
          {nodeList.filter((n) => getNodeStatus(n.last_heard) === "stale").length} stale
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-gray-600 inline-block" />
          {nodeList.filter((n) => getNodeStatus(n.last_heard) === "offline").length} offline
        </span>
      </div>

      <div className="overflow-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-deep-black text-muted text-left sticky top-0 z-10">
              <th className="px-3 py-2 w-8"></th>
              <th className="px-2 py-2 w-6" title="Favorites"></th>
              <th
                className="px-3 py-2 cursor-pointer hover:text-gray-200 transition-colors select-none"
                onClick={() => handleSort("node_id")}
              >
                ID <SortIcon field="node_id" />
              </th>
              <th
                className="px-3 py-2 cursor-pointer hover:text-gray-200 transition-colors select-none"
                onClick={() => handleSort("long_name")}
              >
                Long Name <SortIcon field="long_name" />
              </th>
              <th
                className="px-3 py-2 cursor-pointer hover:text-gray-200 transition-colors select-none"
                onClick={() => handleSort("short_name")}
              >
                Short <SortIcon field="short_name" />
              </th>
              <th
                className="px-3 py-2 cursor-pointer hover:text-gray-200 transition-colors select-none"
                onClick={() => handleSort("last_heard")}
              >
                Last Heard <SortIcon field="last_heard" />
              </th>
              <th
                className="px-3 py-2 cursor-pointer hover:text-gray-200 transition-colors select-none"
                onClick={() => handleSort("role")}
              >
                Role <SortIcon field="role" />
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:text-gray-200 transition-colors select-none"
                onClick={() => handleSort("hops_away")}
              >
                Hops <SortIcon field="hops_away" />
              </th>
              <th
                className="px-3 py-2 text-center cursor-pointer hover:text-gray-200 transition-colors select-none"
                onClick={() => handleSort("via_mqtt")}
              >
                MQTT <SortIcon field="via_mqtt" />
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:text-gray-200 transition-colors select-none"
                onClick={() => handleSort("latitude")}
              >
                Lat <SortIcon field="latitude" />
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:text-gray-200 transition-colors select-none"
                onClick={() => handleSort("longitude")}
              >
                Lon <SortIcon field="longitude" />
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:text-gray-200 transition-colors select-none"
                onClick={() => handleSort("rssi")}
              >
                Signal <SortIcon field="rssi" />
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:text-gray-200 transition-colors select-none"
                onClick={() => handleSort("rssi")}
              >
                RSSI <SortIcon field="rssi" />
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:text-gray-200 transition-colors select-none"
                onClick={() => handleSort("battery")}
              >
                Battery <SortIcon field="battery" />
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:text-gray-200 transition-colors select-none"
                onClick={() => handleSort("voltage")}
              >
                Voltage <SortIcon field="voltage" />
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:text-gray-200 transition-colors select-none"
                onClick={() => handleSort("channel_utilization")}
              >
                Ch.Util <SortIcon field="channel_utilization" />
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:text-gray-200 transition-colors select-none"
                onClick={() => handleSort("air_util_tx")}
              >
                Air Tx <SortIcon field="air_util_tx" />
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:text-gray-200 transition-colors select-none"
                onClick={() => handleSort("altitude")}
              >
                Alt <SortIcon field="altitude" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {nodeList.length === 0 ? (
              <tr>
                <td
                  colSpan={18}
                  className="text-center text-muted py-8"
                >
                  {searchQuery
                    ? "No nodes match your search."
                    : "No nodes discovered yet. Connect to a device to see the mesh network."}
                </td>
              </tr>
            ) : (
              nodeList.map((node) => {
                const isSelf = node.node_id === myNodeNum;
                const status = getNodeStatus(node.last_heard);
                const isMqttOnlyDimmed = ignoreMqttEnabled && !!node.heard_via_mqtt_only;
                const rowOpacity = isMqttOnlyDimmed
                  ? "opacity-50"
                  : status === "offline"
                  ? "opacity-20"
                  : status === "stale"
                  ? "opacity-35"
                  : "";

                return (
                  <tr
                    key={node.node_id}
                    onClick={() => onNodeClick(node)}
                    className={`cursor-pointer hover:bg-secondary-dark/50 transition-colors ${rowOpacity} ${
                      isSelf
                        ? "bg-brand-green/5 border-l-2 border-l-brand-green"
                        : ""
                    }`}
                  >
                    {/* Status indicator */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            status === "online"
                              ? "bg-brand-green"
                              : status === "stale"
                              ? "bg-yellow-500"
                              : "bg-gray-600"
                          }`}
                          title={status}
                        />
                        {isSelf && (
                          <span className="text-[10px] text-bright-green font-bold" title="This is your node">
                            ★
                          </span>
                        )}
                      </div>
                    </td>
                    {/* Favorite toggle */}
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      {!isSelf && (
                        <button
                          onClick={() => onToggleFavorite(node.node_id, !node.favorited)}
                          title={node.favorited ? "Remove from favorites" : "Add to favorites"}
                        >
                          <span className={node.favorited ? "text-yellow-400" : "text-gray-600 hover:text-yellow-400"}>
                            {node.favorited ? "★" : "☆"}
                          </span>
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">
                      !{node.node_id.toString(16)}
                    </td>
                    <td className={`px-3 py-2 ${isSelf ? "text-bright-green font-medium" : "text-gray-200"} ${isMqttOnlyDimmed ? "line-through" : ""}`}>
                      {node.long_name || "-"}
                      {isSelf && (
                        <span className="text-[10px] text-bright-green/60 ml-1.5">(you)</span>
                      )}
                      {!isSelf && anomalies.has(node.node_id) && (
                        <svg
                          className={`w-4 h-4 ml-1 inline shrink-0 ${
                            anomalies.get(node.node_id)?.severity === "error"
                              ? "text-red-400"
                              : "text-orange-400"
                          }`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <title>{anomalies.get(node.node_id)?.description}</title>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      )}
                    </td>
                    <td className={`px-3 py-2 text-gray-300 ${isMqttOnlyDimmed ? "line-through" : ""}`}>
                      {node.short_name || "-"}
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {formatTime(node.last_heard)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <RoleDisplay role={node.role} />
                    </td>
                    <td className={`px-3 py-2 text-right text-xs ${node.hops_away === 0 ? "text-bright-green" : "text-gray-300"}`}>
                      {node.heard_via_mqtt_only
                        ? <span className="text-muted">—</span>
                        : node.hops_away !== undefined ? node.hops_away : "-"}
                    </td>
                    <td className="px-3 py-2 text-center text-gray-300 text-xs">
                      {node.heard_via_mqtt_only
                        ? <span title="Heard only via MQTT" className="text-blue-400">🌐</span>
                        : node.via_mqtt
                        ? <span title="Relay uses MQTT" className="text-gray-400 text-xs">relay</span>
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted">
                      {formatCoord(node.latitude)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted">
                      {formatCoord(node.longitude)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end">
                        {node.heard_via_mqtt_only
                          ? <span className="text-muted text-xs">—</span>
                          : <SignalBars rssi={node.rssi} isSelf={isSelf} />}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted">
                      {node.heard_via_mqtt_only ? "—" : node.rssi != null ? `${node.rssi} dBm` : "-"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {node.battery > 0 && (
                          <div className="w-10 h-1.5 bg-secondary-dark rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                node.battery > 50
                                  ? "bg-brand-green"
                                  : node.battery > 20
                                  ? "bg-yellow-500"
                                  : "bg-red-500"
                              }`}
                              style={{
                                width: `${Math.min(node.battery, 100)}%`,
                              }}
                            />
                          </div>
                        )}
                        <span
                          className={
                            node.battery > 50
                              ? "text-bright-green"
                              : node.battery > 20
                              ? "text-yellow-400"
                              : node.battery > 0
                              ? "text-red-400"
                              : "text-muted"
                          }
                        >
                          {node.battery > 0 ? `${node.battery}%` : "-"}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-300 text-xs">
                      {node.voltage != null ? `${node.voltage.toFixed(2)} V` : "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-300 text-xs">
                      {node.channel_utilization != null ? `${node.channel_utilization.toFixed(1)}%` : "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-300 text-xs">
                      {node.air_util_tx != null ? `${node.air_util_tx.toFixed(1)}%` : "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-300 text-xs">
                      {node.altitude != null && node.altitude !== 0 ? `${node.altitude} m` : "-"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
