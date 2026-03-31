import type { ReactNode } from 'react';

import { parseChatMentionSegments } from '@/renderer/lib/chatMentionSegments';

function highlightCaseInsensitive(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const splitRegex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(splitRegex);
  const lowerQuery = q.toLowerCase();
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === lowerQuery ? (
          <mark key={i} className="rounded bg-yellow-500/40 px-0.5 text-yellow-200">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export interface ChatPayloadTextProps {
  text: string;
  query: string;
}

/**
 * Renders chat body text with Meshtastic/MeshCore `@[Display Name]` tokens shown as
 * compact inline labels (brackets hidden) and optional search highlighting.
 */
export function ChatPayloadText({ text, query }: ChatPayloadTextProps) {
  const segments = parseChatMentionSegments(text);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'mention' ? (
          <span
            key={`m-${i}`}
            className="mx-0.5 inline-flex max-w-full rounded-md border border-cyan-500/35 bg-cyan-500/15 px-1 py-px align-baseline text-[0.92em] leading-snug font-medium text-cyan-100/95 first:ml-0"
            title={seg.label ? `@${seg.label}` : 'Mention'}
            aria-label={seg.label ? `Mention ${seg.label}` : 'Empty mention'}
          >
            @{highlightCaseInsensitive(seg.label, query)}
          </span>
        ) : (
          <span key={`t-${i}`} className="whitespace-pre-wrap">
            {highlightCaseInsensitive(seg.text, query)}
          </span>
        ),
      )}
    </>
  );
}
