import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { parseChatMentionSegments } from '@/renderer/lib/chatMentionSegments';

function highlightCaseInsensitive(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = q.toLowerCase();
  const nodes: ReactNode[] = [];
  let start = 0;
  while (start < text.length) {
    const idx = lowerText.indexOf(lowerQuery, start);
    if (idx === -1) {
      if (start < text.length) {
        nodes.push(<span key={start}>{text.slice(start)}</span>);
      }
      break;
    }
    if (idx > start) {
      nodes.push(<span key={start}>{text.slice(start, idx)}</span>);
    }
    nodes.push(
      <mark key={idx} className="rounded bg-yellow-500/40 px-0.5 text-yellow-200">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    start = idx + q.length;
  }
  if (nodes.length === 0) return text;
  return <>{nodes}</>;
}

interface LinkPreviewData {
  title: string;
  description?: string;
  image?: string;
}

const linkPreviewFetchByUrl = new Map<string, Promise<LinkPreviewData | null>>();

function fetchLinkPreviewDeduped(url: string): Promise<LinkPreviewData | null> {
  const existing = linkPreviewFetchByUrl.get(url);
  if (existing) return existing;
  const pending = window.electronAPI.chat.linkPreview.fetch(url);
  linkPreviewFetchByUrl.set(url, pending);
  void pending.finally(() => {
    if (linkPreviewFetchByUrl.get(url) === pending) {
      linkPreviewFetchByUrl.delete(url);
    }
  });
  return pending;
}

function LinkPreview({ url }: { url: string }) {
  const [preview, setPreview] = useState<LinkPreviewData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLinkPreviewDeduped(url)
      .then((result: LinkPreviewData | null) => {
        if (!cancelled) setPreview(result);
      })
      .catch(() => {
        // catch-no-log-ok: silent failure per design — no preview shown on error
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!preview) return null;

  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    // catch-no-log-ok: url already validated upstream
  }

  return (
    <div className="mt-2 flex max-w-sm gap-3 rounded-md border border-cyan-500/20 bg-cyan-500/5 p-3">
      {preview.image && (
        <img
          src={preview.image}
          alt=""
          className="h-16 w-16 shrink-0 rounded object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-cyan-100">{preview.title}</div>
        {preview.description && (
          <div className="mt-0.5 line-clamp-2 text-xs text-cyan-100/70">{preview.description}</div>
        )}
        {hostname && <div className="mt-1 truncate text-xs text-cyan-100/50">{hostname}</div>}
      </div>
    </div>
  );
}

export interface ChatPayloadTextProps {
  text: string;
  query: string;
}

/**
 * Renders chat body text with Meshtastic/MeshCore `@[Display Name]` tokens shown as
 * compact inline labels (brackets hidden), http/https URLs as clickable links that
 * open in the system browser, and optional search highlighting.
 */
export function ChatPayloadText({ text, query }: ChatPayloadTextProps) {
  const { t } = useTranslation();
  const segments = parseChatMentionSegments(text);
  const urlSegments = segments.filter((seg) => seg.kind === 'url');

  return (
    <div>
      <div>
        {segments.map((seg, i) =>
          seg.kind === 'mention' ? (
            <span
              key={`m-${i}`}
              className="mx-0.5 inline-flex max-w-full rounded-md border border-cyan-500/35 bg-cyan-500/15 px-1 py-px align-baseline text-[0.92em] leading-snug font-medium text-cyan-100/95 first:ml-0"
              title={seg.label ? `@${seg.label}` : 'Mention'}
              aria-label={
                seg.label
                  ? t('chatPayload.mention', { label: seg.label })
                  : t('chatPayload.emptyMention')
              }
            >
              @{highlightCaseInsensitive(seg.label, query)}
            </span>
          ) : seg.kind === 'url' ? (
            <a
              key={`u-${i}`}
              href={seg.url}
              target="_blank"
              rel="noreferrer"
              className="break-all text-cyan-400 underline hover:text-cyan-300"
              title={seg.url}
            >
              {highlightCaseInsensitive(seg.url, query)}
            </a>
          ) : (
            <span key={`t-${i}`} className="whitespace-pre-wrap">
              {highlightCaseInsensitive(seg.text, query)}
            </span>
          ),
        )}
      </div>
      {urlSegments.length > 0 && (
        <div className="space-y-2">
          {urlSegments.map((seg) => (
            <LinkPreview key={seg.url} url={seg.url} />
          ))}
        </div>
      )}
    </div>
  );
}
