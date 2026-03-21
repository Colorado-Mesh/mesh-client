import { useEffect, useRef, useState } from 'react';

import type { MeshNode } from '../lib/types';

interface SearchResult {
  id: number;
  sender_id: number | null;
  sender_name: string | null;
  payload: string;
  channel: number;
  channel_idx?: number;
  timestamp: number;
  to_node: number | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  protocol: 'meshtastic' | 'meshcore';
  nodes: Map<number, MeshNode>;
  channels: { index: number; name: string }[];
  onNavigateToChannel: (channelIdx: number) => void;
}

function parseOperators(raw: string): {
  baseQuery: string;
  userFilter: string;
  channelFilter: string;
} {
  let baseQuery = raw;
  let userFilter = '';
  let channelFilter = '';

  const userMatch = raw.match(/\buser:(\S+)/i);
  if (userMatch) {
    userFilter = userMatch[1].toLowerCase();
    baseQuery = baseQuery.replace(userMatch[0], '').trim();
  }
  const channelMatch = raw.match(/\bchannel:(\S+)/i);
  if (channelMatch) {
    channelFilter = channelMatch[1].toLowerCase();
    baseQuery = baseQuery.replace(channelMatch[0], '').trim();
  }

  return { baseQuery: baseQuery.trim(), userFilter, channelFilter };
}

export default function SearchModal({
  isOpen,
  onClose,
  protocol,
  nodes,
  channels,
  onNavigateToChannel,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keyboard: Escape closes modal
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const { baseQuery, userFilter, channelFilter } = parseOperators(query);
    if (!baseQuery && !userFilter && !channelFilter) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      if (!baseQuery && !userFilter && !channelFilter) return;
      setLoading(true);
      try {
        let raw: unknown[];
        if (protocol === 'meshcore') {
          raw = await window.electronAPI.db.searchMeshcoreMessages(baseQuery || ' ', 100);
        } else {
          raw = await window.electronAPI.db.searchMessages(baseQuery || ' ', 100);
        }
        let items = (raw as SearchResult[]).map((r) => ({
          ...r,
          channel: r.channel_idx ?? r.channel ?? 0,
        }));
        if (userFilter) {
          items = items.filter((r) => (r.sender_name ?? '').toLowerCase().includes(userFilter));
        }
        if (channelFilter) {
          items = items.filter((r) => {
            const ch = channels.find((c) => c.index === r.channel);
            return (ch?.name ?? String(r.channel)).toLowerCase().includes(channelFilter);
          });
        }
        setResults(items);
      } catch (e) {
        console.warn('[SearchModal] search error', e);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, protocol, channels]);

  if (!isOpen) return null;

  const getChannelName = (idx: number) => {
    if (idx === -1) return 'DM';
    return channels.find((c) => c.index === idx)?.name ?? `Ch ${idx}`;
  };

  const getSenderName = (r: SearchResult) => {
    if (r.sender_id) {
      const node = nodes.get(r.sender_id);
      if (node) return node.long_name;
    }
    return r.sender_name ?? 'Unknown';
  };

  const formatTs = (ts: number) => {
    const d = new Date(ts);
    return (
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    );
  };

  const handleResultClick = (r: SearchResult) => {
    onNavigateToChannel(r.channel);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24">
      <button
        type="button"
        aria-label="Close search"
        className="absolute inset-0 bg-black/60 cursor-pointer border-0 p-0"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-2xl mx-4 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col max-h-[60vh]">
        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
          <svg
            className="w-4 h-4 text-gray-400 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all messages… (user:name, channel:name)"
            spellCheck={false}
            className="flex-1 bg-transparent text-gray-200 text-sm focus:outline-none placeholder-gray-500"
          />
          {loading && (
            <span className="w-4 h-4 border border-gray-400 border-t-transparent rounded-full animate-spin shrink-0" />
          )}
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Results */}
        <div className="overflow-y-auto">
          {results.length === 0 && !loading && query.trim() && (
            <p className="text-center text-gray-500 text-sm py-8">No results</p>
          )}
          {results.length === 0 && !query.trim() && (
            <p className="text-center text-gray-600 text-sm py-8">
              Type to search across all channels
            </p>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => handleResultClick(r)}
              className="w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800/60 transition-colors"
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs px-1.5 py-0.5 rounded bg-brand-green/20 text-brand-green font-mono">
                  {getChannelName(r.channel)}
                </span>
                <span className="text-xs text-gray-400">{getSenderName(r)}</span>
                <span className="text-xs text-gray-600 ml-auto">{formatTs(r.timestamp)}</span>
              </div>
              <p className="text-sm text-gray-300 truncate">
                {r.payload.length > 120 ? r.payload.slice(0, 120) + '…' : r.payload}
              </p>
            </button>
          ))}
        </div>

        {results.length > 0 && (
          <div className="px-4 py-2 text-xs text-gray-600 border-t border-gray-800">
            {results.length} result{results.length !== 1 ? 's' : ''} — click to navigate
          </div>
        )}
      </div>
    </div>
  );
}
