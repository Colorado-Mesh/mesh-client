/**
 * Virtualized raw RF / mesh packet log. Shown on the **Sniffer** tab in the UI; keyboard shortcuts
 * help refers to it as **Packet Sniffer** (component name retains RawPacket* for code consistency).
 */
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useMemo, useRef, useState } from 'react';

import { formatLogTimeOfDay } from '../../shared/formatLogTimestamp';
import { parseMeshCoreRfPacket } from '../../shared/meshcoreRfPacketParse';
import type { RxPacketEntry } from '../hooks/useMeshCore';
import { meshcoreRawPacketSenderColumnText } from '../lib/nodeLongNameOrHex';
import type { MeshtasticRawPacketEntry } from '../lib/rawPacketLogConstants';

const ROUTE_LABEL: Record<string, string> = {
  FLOOD: 'FLOOD',
  DIRECT: 'DIRECT',
  TRANSPORT_FLOOD: 'T_FLOOD',
  TRANSPORT_DIRECT: 'T_DIRECT',
};

/** Sender column: Meshtastic long names can be ~36 chars; flex so the row shares space without a 120px cap. */
const RAW_PACKET_NAME_COL = 'min-w-0 flex-1 max-w-[min(28rem,50vw)]';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function formatTs(ts: number): string {
  return formatLogTimeOfDay(ts);
}

function innerPayloadFirstU32Hex(inner: Uint8Array): { be: string; le: string } | null {
  if (inner.length < 4) return null;
  const dv = new DataView(inner.buffer, inner.byteOffset, inner.byteLength);
  const be = (dv.getUint32(0, false) >>> 0).toString(16).toUpperCase().padStart(8, '0');
  const le = (dv.getUint32(0, true) >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return { be, le };
}

function MeshcoreExpandedDetails({ p }: { p: RxPacketEntry }) {
  if (!p.parseOk) return null;
  const reparsed = parseMeshCoreRfPacket(p.raw);
  const innerWords =
    reparsed.ok && reparsed.innerPayload.length >= 4
      ? innerPayloadFirstU32Hex(reparsed.innerPayload)
      : null;
  return (
    <div className="mb-2 space-y-0.5 text-[10px] text-gray-400">
      {p.messageFingerprintHex != null && (
        <p>
          <span className="text-muted">CRC32 fp:</span> {p.messageFingerprintHex}
        </p>
      )}
      {innerWords != null && (
        <p title="First four bytes after path prefix; not a node id. Meaning depends on payload type.">
          <span className="text-muted">Inner first u32 (debug):</span>{' '}
          {`BE 0x${innerWords.be} · LE 0x${innerWords.le}`}
        </p>
      )}
      {p.transportScopeCode != null && p.transportReturnCode != null && (
        <p>
          <span className="text-muted">Transport:</span>{' '}
          {`scope=${p.transportScopeCode} return=${p.transportReturnCode}`}
        </p>
      )}
      {p.advertTimestampSec != null && p.advertTimestampSec > 0 && (
        <p>
          <span className="text-muted">ADVERT ts:</span> {p.advertTimestampSec}
        </p>
      )}
      {(p.advertLat != null || p.advertLon != null) && (
        <p>
          <span className="text-muted">ADVERT lat/lon:</span>{' '}
          {p.advertLat != null ? p.advertLat.toFixed(5) : '?'},{' '}
          {p.advertLon != null ? p.advertLon.toFixed(5) : '?'}
        </p>
      )}
    </div>
  );
}

interface MeshcoreProps {
  variant: 'meshcore';
  packets: RxPacketEntry[];
  onClear: () => void;
  getNodeLabel: (nodeId: number) => string;
  onNodeClick?: (nodeId: number) => void;
}

interface MeshtasticProps {
  variant: 'meshtastic';
  packets: MeshtasticRawPacketEntry[];
  onClear: () => void;
  getNodeLabel: (nodeId: number) => string;
  onNodeClick?: (nodeId: number) => void;
}

type Props = MeshcoreProps | MeshtasticProps;

export default function RawPacketLogPanel(props: Props) {
  const { variant, packets, onClear, getNodeLabel, onNodeClick } = props;
  const [filter, setFilter] = useState('');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const filtered = useMemo(() => {
    if (!filter.trim()) return packets;
    const q = filter.trim().toUpperCase();
    const f = filter.trim().toLowerCase();
    if (variant === 'meshcore') {
      return packets.filter(
        (p) =>
          (p.routeTypeString ?? '').includes(q) ||
          (p.payloadTypeString ?? '').includes(q) ||
          (p.messageFingerprintHex ?? '').toUpperCase().includes(q) ||
          (p.advertName ?? '').toUpperCase().includes(q) ||
          (p.transportScopeCode != null && String(p.transportScopeCode).includes(f)) ||
          (p.transportReturnCode != null && String(p.transportReturnCode).includes(f)) ||
          toHex(p.raw).includes(f) ||
          (p.fromNodeId != null &&
            meshcoreRawPacketSenderColumnText(p.fromNodeId, getNodeLabel)
              .toUpperCase()
              .includes(q)),
      );
    }
    return packets.filter(
      (p) =>
        (p.portLabel ?? '').includes(q) ||
        toHex(p.raw).includes(f) ||
        (p.viaMqtt && 'mqtt'.includes(f)) ||
        (p.fromNodeId != null && getNodeLabel(p.fromNodeId).toUpperCase().includes(q)),
    );
  }, [packets, filter, variant, getNodeLabel]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 12,
  });

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  const handleClear = useCallback(() => {
    setExpandedIdx(null);
    onClear();
  }, [onClear]);

  const emptyMessage = 'No new mesh packets received yet. Please wait...';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-700 px-3 py-2">
        <input
          type="search"
          placeholder="Filter by type, name, or hex..."
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
          }}
          aria-label="Filter packets"
          className="min-w-0 flex-1 rounded border border-gray-600 bg-slate-800 px-2 py-1 font-mono text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        <span className="text-muted shrink-0 text-[10px]">{filtered.length}</span>
        <button
          type="button"
          onClick={handleClear}
          disabled={packets.length === 0}
          aria-label="Clear packet log"
          className="shrink-0 rounded border border-gray-600 bg-slate-800 px-2 py-1 text-xs text-gray-300 hover:bg-slate-700 disabled:opacity-40"
        >
          Clear
        </button>
      </div>

      {packets.length === 0 ? (
        <div className="text-muted flex flex-1 items-center justify-center text-xs">
          {emptyMessage}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-muted flex flex-1 items-center justify-center text-xs">
          No packets match the current filter.
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-auto font-mono text-[11px] text-gray-300"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const isExpanded = expandedIdx === vi.index;
              const hexRaw =
                variant === 'meshcore'
                  ? toHex((filtered as RxPacketEntry[])[vi.index].raw)
                  : toHex((filtered as MeshtasticRawPacketEntry[])[vi.index].raw);
              const byteLen =
                variant === 'meshcore'
                  ? (filtered as RxPacketEntry[])[vi.index].raw.length
                  : (filtered as MeshtasticRawPacketEntry[])[vi.index].raw.length;

              const toggleExpand = () => {
                setExpandedIdx(isExpanded ? null : vi.index);
              };

              return (
                <div
                  key={`${vi.index}-${variant === 'meshcore' ? (filtered as RxPacketEntry[])[vi.index].ts : (filtered as MeshtasticRawPacketEntry[])[vi.index].ts}`}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full border-b border-gray-800"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  <div className="flex w-full items-start">
                    {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- row expands hex on click; node name uses inner button + stopPropagation */}
                    <div
                      className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 px-3 py-1.5 text-left hover:bg-slate-800/60"
                      onClick={toggleExpand}
                    >
                      {variant === 'meshcore' ? (
                        <MeshcoreRow
                          p={(filtered as RxPacketEntry[])[vi.index]}
                          getNodeLabel={getNodeLabel}
                          onNodeClick={onNodeClick}
                        />
                      ) : (
                        <MeshtasticRow
                          p={(filtered as MeshtasticRawPacketEntry[])[vi.index]}
                          getNodeLabel={getNodeLabel}
                          onNodeClick={onNodeClick}
                        />
                      )}
                    </div>
                    <span className="text-muted shrink-0 px-3 py-1.5 text-[10px]">{byteLen}B</span>
                  </div>
                  {isExpanded && (
                    <div className="bg-slate-900/60 px-3 pb-2">
                      {variant === 'meshcore' && (
                        <MeshcoreExpandedDetails p={(filtered as RxPacketEntry[])[vi.index]} />
                      )}
                      <p className="text-muted mb-1 text-[10px]">Raw hex ({byteLen} bytes):</p>
                      <p className="text-[10px] break-all text-gray-400">{hexRaw}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MeshcoreRow({
  p,
  getNodeLabel,
  onNodeClick,
}: {
  p: RxPacketEntry;
  getNodeLabel: (nodeId: number) => string;
  onNodeClick?: (nodeId: number) => void;
}) {
  const routeLabel =
    p.routeTypeString != null ? (ROUTE_LABEL[p.routeTypeString] ?? p.routeTypeString) : '?';
  const payloadLabel = p.payloadTypeString ?? '?';
  const senderLine =
    p.fromNodeId != null ? meshcoreRawPacketSenderColumnText(p.fromNodeId, getNodeLabel) : null;
  const name =
    p.fromNodeId != null ? (
      onNodeClick ? (
        <div className={RAW_PACKET_NAME_COL}>
          <button
            type="button"
            className="block w-full min-w-0 truncate text-left text-cyan-200/90 underline-offset-2 hover:underline"
            title={senderLine ?? undefined}
            aria-label={`Open node details for ${senderLine ?? p.fromNodeId}`}
            onClick={(e) => {
              e.stopPropagation();
              onNodeClick(p.fromNodeId!);
            }}
          >
            {senderLine}
          </button>
        </div>
      ) : (
        <span
          className={`${RAW_PACKET_NAME_COL} truncate text-cyan-200/90`}
          title={senderLine ?? undefined}
        >
          {senderLine}
        </span>
      )
    ) : (
      <span className="text-muted shrink-0">—</span>
    );
  return (
    <>
      <span className="text-muted w-[90px] shrink-0 text-[10px]">{formatTs(p.ts)}</span>
      {name}
      <span
        className={`w-[72px] shrink-0 rounded px-1 text-[10px] font-semibold ${
          p.routeTypeString === 'FLOOD' || p.routeTypeString === 'TRANSPORT_FLOOD'
            ? 'bg-blue-900/50 text-blue-300'
            : p.routeTypeString === 'DIRECT' || p.routeTypeString === 'TRANSPORT_DIRECT'
              ? 'bg-green-900/50 text-green-300'
              : 'bg-gray-700 text-gray-400'
        }`}
      >
        {routeLabel}
      </span>
      <span className="w-[80px] shrink-0 text-yellow-300/80">{payloadLabel}</span>
      <span className="text-muted min-w-0 flex-1">
        {p.hopCount > 0 ? `hops=${p.hopCount} ` : ''}
        SNR={p.snr.toFixed(1)} RSSI={p.rssi}
        {p.transportScopeCode != null && p.transportReturnCode != null
          ? ` · tc=${p.transportScopeCode}/${p.transportReturnCode}`
          : ''}
        {p.advertName
          ? ` · ${p.advertName.length > 36 ? `${p.advertName.slice(0, 36)}…` : p.advertName}`
          : ''}
      </span>
    </>
  );
}

function MeshtasticRow({
  p,
  getNodeLabel,
  onNodeClick,
}: {
  p: MeshtasticRawPacketEntry;
  getNodeLabel: (nodeId: number) => string;
  onNodeClick?: (nodeId: number) => void;
}) {
  const label = p.fromNodeId != null ? getNodeLabel(p.fromNodeId) : null;
  const name =
    p.fromNodeId != null ? (
      onNodeClick ? (
        <div className={RAW_PACKET_NAME_COL}>
          <button
            type="button"
            className="block w-full min-w-0 truncate text-left text-cyan-200/90 underline-offset-2 hover:underline"
            title={label ?? undefined}
            aria-label={`Open node details for ${label ?? p.fromNodeId}`}
            onClick={(e) => {
              e.stopPropagation();
              onNodeClick(p.fromNodeId!);
            }}
          >
            {label}
          </button>
        </div>
      ) : (
        <span
          className={`${RAW_PACKET_NAME_COL} truncate text-cyan-200/90`}
          title={label ?? undefined}
        >
          {label}
        </span>
      )
    ) : (
      <span className="text-muted shrink-0">—</span>
    );
  return (
    <>
      <span className="text-muted w-[90px] shrink-0 text-[10px]">{formatTs(p.ts)}</span>
      {name}
      <span className="w-[100px] shrink-0 truncate text-amber-200/90" title={p.portLabel}>
        {p.portLabel}
      </span>
      <span
        className={`w-[52px] shrink-0 rounded px-1 text-[10px] font-semibold ${
          p.viaMqtt ? 'bg-purple-900/50 text-purple-200' : 'bg-slate-700 text-slate-200'
        }`}
      >
        {p.viaMqtt ? 'MQTT' : 'RF'}
      </span>
      <span className="text-muted min-w-0 flex-1">
        SNR={p.snr.toFixed(1)} RSSI={p.rssi}
      </span>
    </>
  );
}
