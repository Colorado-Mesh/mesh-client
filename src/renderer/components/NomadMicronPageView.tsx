import { useEffect, useLayoutEffect, useRef } from 'react';

import {
  bindNomadMicronMedia,
  bindNomadMicronPartials,
  buildNomadLinkRequest,
  isExternalHttpUrl,
  isNomadFilePath,
  loadNomadMicronPartial,
  mountNomadMicronHtml,
  type NomadMicronMediaFetchResult,
  type NomadMicronPartialPageResult,
  parseNomadNetworkLinkUrl,
  renderNomadMicronPage,
} from '@/renderer/lib/nomad/micronParser';
import { nomadRasterDataUrl } from '@/renderer/lib/nomad/nomadRasterPreview';
import { openRrcHubFromLink } from '@/renderer/lib/openRrcHubFromLink';
import {
  isReticulumLxmfLink,
  parseReticulumLxmfLinkUrl,
} from '@/renderer/lib/reticulum/reticulumDestinationInput';
import { isRrcLink } from '@/renderer/lib/rrcLink';

interface NomadMicronPageViewProps {
  content: string;
  defaultPagePath: string;
  selectedHash: string;
  /** When true, constrain page width to the viewer and wrap text (default for prose). */
  fitWidth?: boolean;
  onNavigate: (hash: string, path: string, requestData?: Record<string, string>) => void;
  onDownloadFile: (hash: string, path: string) => void;
  onOpenDm?: (destinationHash: string) => void;
  /** Fetch Micron partial page content (same path as full Nomad page loads). */
  onFetchPartial?: (
    hash: string,
    path: string,
    requestData?: Record<string, string>,
  ) => Promise<NomadMicronPartialPageResult>;
  /** Fetch NomadNet `/media` WebP bytes for in-page images (not `/file` downloads). */
  onFetchMedia?: (hash: string, mediaPath: string) => Promise<NomadMicronMediaFetchResult>;
}

function mediaBindOptions(
  ctx: {
    selectedHash: string;
    defaultPagePath: string;
    onFetchMedia?: (hash: string, mediaPath: string) => Promise<NomadMicronMediaFetchResult>;
  },
  signal: AbortSignal,
) {
  const fetchMedia = ctx.onFetchMedia;
  if (!fetchMedia) return null;
  return {
    selectedHash: ctx.selectedHash,
    defaultPagePath: ctx.defaultPagePath,
    signal,
    fetchMedia: (hash: string, mediaPath: string) => fetchMedia(hash, mediaPath),
    toDataUrl: (fileName: string, contentBase64: string) =>
      nomadRasterDataUrl(
        fileName.toLowerCase().endsWith('.webp') ? fileName : `${fileName}.webp`,
        contentBase64,
      ) ?? nomadRasterDataUrl('image.webp', contentBase64),
  };
}

export default function NomadMicronPageView({
  content,
  defaultPagePath,
  selectedHash,
  fitWidth = true,
  onNavigate,
  onDownloadFile,
  onOpenDm,
  onFetchPartial,
  onFetchMedia,
}: NomadMicronPageViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep latest link handlers/context in a ref so Micron remounts only when `content` changes.
  // Parent panel re-renders often (node list / store); unstable callback identity must not
  // re-parse large Micron pages (~0.5s each) or the whole app freezes.
  const linkContextRef = useRef({
    defaultPagePath,
    selectedHash,
    onNavigate,
    onDownloadFile,
    onOpenDm,
    onFetchPartial,
    onFetchMedia,
  });
  useLayoutEffect(() => {
    linkContextRef.current = {
      defaultPagePath,
      selectedHash,
      onNavigate,
      onDownloadFile,
      onOpenDm,
      onFetchPartial,
      onFetchMedia,
    };
  }, [
    defaultPagePath,
    selectedHash,
    onNavigate,
    onDownloadFile,
    onOpenDm,
    onFetchPartial,
    onFetchMedia,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    mountNomadMicronHtml(container, renderNomadMicronPage(content));

    const handleNomadLink = (destination: string, dataFieldsAttr?: string | null) => {
      const ctx = linkContextRef.current;
      if (isExternalHttpUrl(destination)) {
        window.open(destination, '_blank', 'noopener,noreferrer');
        return;
      }

      if (isRrcLink(destination)) {
        openRrcHubFromLink(destination);
        return;
      }

      const lxmfHash = parseReticulumLxmfLinkUrl(destination);
      if (lxmfHash) {
        ctx.onOpenDm?.(lxmfHash);
        return;
      }

      const { destination: linkDest, requestData } = buildNomadLinkRequest(
        destination,
        dataFieldsAttr,
        containerRef.current,
      );

      const parsed = parseNomadNetworkLinkUrl(linkDest, ctx.defaultPagePath);
      if (!parsed) return;

      const hash = parsed.destination_hash ?? ctx.selectedHash;
      if (isNomadFilePath(parsed.path)) {
        ctx.onDownloadFile(hash, parsed.path);
        return;
      }
      ctx.onNavigate(
        hash,
        parsed.path,
        Object.keys(requestData).length > 0 ? requestData : undefined,
      );
    };

    // Event delegation so links inside async-loaded partials keep working.
    const onActivate = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const element = target.closest<HTMLElement>('[data-action="openNode"]');
      if (!element || !container.contains(element)) return;
      const href = element.getAttribute('href') ?? '';
      const title = element.getAttribute('title') ?? '';
      const dataDestination = element.dataset.destination ?? '';
      // In-page Micron anchors (`#slug`) — let the browser scroll; do not treat as Nomad nav.
      if (href.startsWith('#') || dataDestination.startsWith('#')) {
        return;
      }
      event.preventDefault();
      // micron-parser strips lxmf:// / rrc:// from data-destination; href/title keep schemes.
      const rrcSource = [href, title, dataDestination].find((v) => v && isRrcLink(v));
      if (rrcSource) {
        openRrcHubFromLink(rrcSource);
        return;
      }
      const lxmfSource = [href, title].find((v) => v && isReticulumLxmfLink(v));
      const destination = (lxmfSource ?? dataDestination) || href;
      if (!destination) return;
      const dataFields = element.dataset.fields;
      handleNomadLink(destination, dataFields);
    };
    container.addEventListener('click', onActivate);

    const partialMediaAborts: AbortController[] = [];
    const onPartialLoaded = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement) || !el.classList.contains('Mu-partial')) return;
      if (!container.contains(el)) return;
      const ac = new AbortController();
      partialMediaAborts.push(ac);
      const bindOpts = mediaBindOptions(linkContextRef.current, ac.signal);
      if (!bindOpts) return;
      void bindNomadMicronMedia(el, bindOpts);
    };
    container.addEventListener('partial-loaded', onPartialLoaded);

    let unbindPartials: (() => void) | undefined;
    if (linkContextRef.current.onFetchPartial) {
      unbindPartials = bindNomadMicronPartials(container, async (info) => {
        const ctx = linkContextRef.current;
        const fetchPage = ctx.onFetchPartial;
        if (!fetchPage) return null;
        try {
          return await loadNomadMicronPartial({
            destination: info.destination,
            fields: info.fields,
            signal: info.signal,
            defaultPagePath: ctx.defaultPagePath,
            selectedHash: ctx.selectedHash,
            formContainer: containerRef.current,
            fetchPage,
          });
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e;
          console.warn('[NomadMicronPageView] partial fetch failed', e);
          throw e;
        }
      });
    }

    return () => {
      container.removeEventListener('click', onActivate);
      container.removeEventListener('partial-loaded', onPartialLoaded);
      for (const ac of partialMediaAborts) ac.abort();
      unbindPartials?.();
    };
  }, [content]);

  // Rebind /media when page content or fetch context changes (hash / path / fetcher).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onFetchMedia) return;
    const ac = new AbortController();
    const opts = mediaBindOptions({ selectedHash, defaultPagePath, onFetchMedia }, ac.signal);
    if (opts) void bindNomadMicronMedia(container, opts);
    return () => {
      ac.abort();
    };
  }, [content, selectedHash, defaultPagePath, onFetchMedia]);

  return (
    <div
      ref={containerRef}
      className={[
        'nomad-micron-page text-sm leading-snug text-gray-200',
        // Default link chrome only when Micron did not set an inline color
        // (so `` `FT020617` `` tips matching #!bg stay invisible).
        '[&_a]:underline [&_a:not([style*="color"])]:text-amber-400 [&_a:not([style*="color"]):hover]:text-amber-300',
        '[&_hr]:my-3 [&_hr]:border-gray-600',
        '[&_input]:rounded [&_input]:border [&_input]:border-gray-600 [&_input]:bg-slate-900 [&_input]:px-1 [&_input]:text-gray-200',
        fitWidth ? 'nomad-micron-page--fit-width' : null,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
