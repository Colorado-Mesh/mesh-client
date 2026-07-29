import type { ReactNode } from 'react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatInlineImage } from '@/renderer/components/chat/ChatInlineImage';
import { buildStaticTileUrl, parseLocationMessage } from '@/renderer/lib/chatLocationUtils';
import { isSafeChatUrl, parseChatMentionSegments } from '@/renderer/lib/chatMentionSegments';
import {
  meshcoreGiphyMediaUrl,
  meshcoreGiphyPageUrl,
  parseMeshcoreGifId,
} from '@/renderer/lib/meshcoreGifWire';
import { isLikelyDirectImageUrl } from '@/shared/chatDirectImageUrl';

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
  /** Present when the URL itself is a raster image (not an HTML page with og:image). */
  kind?: 'image';
}

const LINK_PREVIEW_FETCH_DEDUP_MAX = 128;
const linkPreviewFetchByUrl = new Map<string, Promise<LinkPreviewData | null>>();

function fetchLinkPreviewDeduped(url: string): Promise<LinkPreviewData | null> {
  const existing = linkPreviewFetchByUrl.get(url);
  if (existing) return existing;
  while (linkPreviewFetchByUrl.size >= LINK_PREVIEW_FETCH_DEDUP_MAX) {
    const oldest = linkPreviewFetchByUrl.keys().next().value;
    if (oldest === undefined) break;
    linkPreviewFetchByUrl.delete(oldest);
  }
  const pending = window.electronAPI.chat.linkPreview.fetch(url);
  linkPreviewFetchByUrl.set(url, pending);
  void pending.finally(() => {
    if (linkPreviewFetchByUrl.get(url) === pending) {
      linkPreviewFetchByUrl.delete(url);
    }
  });
  return pending;
}

function DirectImageEmbed({
  url,
  imageSrc,
  title,
  onContentResize,
}: {
  url: string;
  imageSrc: string;
  title: string;
  onContentResize?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <ChatInlineImage
      src={imageSrc}
      alt={t('chatPayload.directImage', { name: title })}
      href={url}
      title={t('chatPayload.directImageOpen')}
      onContentResize={onContentResize}
    />
  );
}

function LinkPreview({ url, onContentResize }: { url: string; onContentResize?: () => void }) {
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

  useLayoutEffect(() => {
    if (preview) onContentResize?.();
  }, [preview, onContentResize]);

  if (!preview) return null;

  const showAsDirectImage =
    Boolean(preview.image) && (preview.kind === 'image' || isLikelyDirectImageUrl(url));
  if (showAsDirectImage && preview.image) {
    return (
      <DirectImageEmbed
        url={url}
        imageSrc={preview.image}
        title={preview.title}
        onContentResize={onContentResize}
      />
    );
  }

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

function MeshcoreGifEmbed({
  gifId,
  query,
  onContentResize,
}: {
  gifId: string;
  query: string;
  onContentResize?: () => void;
}) {
  const { t } = useTranslation();
  const src = meshcoreGiphyMediaUrl(gifId);
  const pageUrl = meshcoreGiphyPageUrl(gifId);
  const wireText = `g:${gifId}`;

  return (
    <ChatInlineImage
      src={src}
      alt={t('chatPayload.meshcoreGif')}
      href={pageUrl}
      title={t('chatPayload.meshcoreGifOpen')}
      onContentResize={onContentResize}
      fallback={
        <span className="whitespace-pre-wrap text-gray-300">
          {highlightCaseInsensitive(wireText, query)}
        </span>
      }
    />
  );
}

function LocationCard({
  lat,
  lon,
  mapUrl,
  query,
  onContentResize,
}: Readonly<{
  lat: number;
  lon: number;
  mapUrl: string;
  query: string;
  onContentResize?: () => void;
}>) {
  const { t } = useTranslation();
  const [tileFailed, setTileFailed] = useState(false);
  const tileUrl = buildStaticTileUrl(lat, lon);
  const coordLabel = `${lat}, ${lon}`;

  return (
    <div className="space-y-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-2">
      {!tileFailed && (
        <img
          src={tileUrl}
          alt={t('chatPayload.locationCard.alt')}
          className="h-32 w-full rounded object-cover"
          onLoad={() => {
            onContentResize?.();
          }}
          onError={() => {
            setTileFailed(true);
          }}
        />
      )}
      <div className="text-xs text-cyan-100/90">
        📍 {highlightCaseInsensitive(coordLabel, query)}
      </div>
      <a
        href={mapUrl}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-cyan-400 underline hover:text-cyan-300"
      >
        {t('chatPayload.locationCard.openMaps')}
      </a>
    </div>
  );
}

export interface ChatPayloadTextProps {
  text: string;
  query: string;
  /** When false, skip async link-preview fetches (avoids layout shift while reading history). */
  loadLinkPreviews?: boolean;
  /** Fired when async link-preview content mounts and row height may have grown. */
  onContentResize?: () => void;
}

/**
 * Renders chat body text with Meshtastic/MeshCore `@[Display Name]` tokens shown as
 * compact inline labels (brackets hidden), http/https URLs as clickable links that
 * open in the system browser, and optional search highlighting.
 */
export function ChatPayloadText({
  text,
  query,
  loadLinkPreviews = true,
  onContentResize,
}: ChatPayloadTextProps) {
  const { t } = useTranslation();
  const gifId = parseMeshcoreGifId(text);
  if (gifId) {
    return (
      <div>
        <MeshcoreGifEmbed gifId={gifId} query={query} onContentResize={onContentResize} />
      </div>
    );
  }
  const location = parseLocationMessage(text);
  if (location) {
    return (
      <div>
        <LocationCard
          lat={location.lat}
          lon={location.lon}
          mapUrl={location.mapUrl}
          query={query}
          onContentResize={onContentResize}
        />
      </div>
    );
  }
  const segments = parseChatMentionSegments(text);
  const urlSegments = segments.filter((seg) => seg.kind === 'url');

  return (
    <div>
      <div>
        {segments.map((seg, i) =>
          seg.kind === 'mention' ? (
            seg.label ? (
              <span
                key={`m-${i}`}
                className="mx-0.5 inline-flex max-w-full rounded-md border border-cyan-500/35 bg-cyan-500/15 px-1 py-px align-baseline text-[0.92em] leading-snug font-medium text-cyan-100/95 first:ml-0"
                title={`@${seg.label}`}
                aria-label={t('chatPayload.mention', { label: seg.label })}
              >
                @{highlightCaseInsensitive(seg.label, query)}
              </span>
            ) : null
          ) : seg.kind === 'url' ? (
            isSafeChatUrl(seg.url) ? (
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
              <span key={`u-${i}`} className="break-all whitespace-pre-wrap">
                {highlightCaseInsensitive(seg.url, query)}
              </span>
            )
          ) : (
            <span key={`t-${i}`} className="whitespace-pre-wrap">
              {highlightCaseInsensitive(seg.text, query)}
            </span>
          ),
        )}
      </div>
      {loadLinkPreviews && urlSegments.length > 0 && (
        <div className="space-y-2">
          {urlSegments.map((seg) => (
            <LinkPreview key={seg.url} url={seg.url} onContentResize={onContentResize} />
          ))}
        </div>
      )}
    </div>
  );
}
