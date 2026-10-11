import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  bindNomadMicronMedia,
  bindNomadMicronPartials,
  buildNomadLinkRequest,
  canonicalNomadPageResourceKey,
  isExternalHttpUrl,
  isNomadFilePath,
  loadNomadMicronPartial,
  mountNomadMicronHtml,
  type NomadMicronMediaFetchResult,
  type NomadMicronPartialPageResult,
  parseNomadNetworkLinkUrl,
  renderNomadMicronPage,
  resolveNomadPartialResourceKey,
} from '@/renderer/lib/nomad/micronParser';
import { nomadRasterDataUrl } from '@/renderer/lib/nomad/nomadRasterPreview';
import { openRrcHubFromLink } from '@/renderer/lib/openRrcHubFromLink';
import {
  isReticulumLxmfLink,
  parseReticulumLxmfLinkUrl,
} from '@/renderer/lib/reticulum/reticulumDestinationInput';
import { isRrcLink } from '@/renderer/lib/rrcLink';

import { Button } from './ui/Button';

interface NomadMicronPageViewProps {
  content: string;
  defaultPagePath: string;
  /** Actual path of the page whose content is rendered. */
  pagePath: string;
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
  pagePath,
  selectedHash,
  fitWidth = true,
  onNavigate,
  onDownloadFile,
  onOpenDm,
  onFetchPartial,
  onFetchMedia,
}: NomadMicronPageViewProps) {
  const { t } = useTranslation();
  const [partialsPaused, setPartialsPaused] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
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
    setPartialsPaused(false);
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

    const partialMediaAborts = new Map<HTMLElement, AbortController>();
    const abortPartialMediaTree = (element: HTMLElement) => {
      for (const [owner, controller] of partialMediaAborts) {
        if (owner === element || element.contains(owner)) {
          controller.abort();
          partialMediaAborts.delete(owner);
        }
      }
    };
    const onPartialReplacing = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement) || !el.classList.contains('Mu-partial')) return;
      if (!container.contains(el)) return;
      abortPartialMediaTree(el);
    };
    const onPartialLoaded = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement) || !el.classList.contains('Mu-partial')) return;
      if (!container.contains(el)) return;
      abortPartialMediaTree(el);
      const ac = new AbortController();
      const bindOpts = mediaBindOptions(linkContextRef.current, ac.signal);
      if (!bindOpts) return;
      partialMediaAborts.set(el, ac);
      void bindNomadMicronMedia(el, bindOpts);
    };
    container.addEventListener('partial-replacing', onPartialReplacing);
    container.addEventListener('partial-loaded', onPartialLoaded);

    let unbindPartials: (() => void) | undefined;
    if (linkContextRef.current.onFetchPartial) {
      unbindPartials = bindNomadMicronPartials(
        container,
        async (info) => {
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
        },
        {
          onPaused: () => {
            setPartialsPaused(true);
          },
          rootResourceKey: canonicalNomadPageResourceKey(selectedHash, pagePath),
          resolveResourceKey: (info) =>
            resolveNomadPartialResourceKey(info.destination, selectedHash, defaultPagePath),
        },
      );
    }

    return () => {
      container.removeEventListener('click', onActivate);
      container.removeEventListener('partial-replacing', onPartialReplacing);
      container.removeEventListener('partial-loaded', onPartialLoaded);
      for (const ac of partialMediaAborts.values()) ac.abort();
      partialMediaAborts.clear();
      unbindPartials?.();
    };
  }, [content, defaultPagePath, pagePath, selectedHash, reloadCount]);

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
  }, [content, selectedHash, defaultPagePath, onFetchMedia, reloadCount]);

  return (
    <div>
      {partialsPaused && (
        <div role="status" className="mb-2 flex items-center gap-2 text-sm text-orange-400">
          <span>{t('nomadNetwork.partialsPaused')}</span>
          <Button
            size="sm"
            variant="secondary"
            aria-label={t('nomadNetwork.reloadPage')}
            onClick={() => {
              setReloadCount((count) => count + 1);
            }}
          >
            {t('nomadNetwork.reloadPage')}
          </Button>
        </div>
      )}
      <div
        ref={containerRef}
        className={[
          'nomad-micron-page text-ink-200 text-sm leading-snug',
          // Default link chrome only when Micron did not set an inline color
          // (so `` `FT020617` `` tips matching #!bg stay invisible).
          '[&_a]:underline [&_a:not([style*="color"])]:text-yellow-400 [&_a:not([style*="color"]):hover]:text-yellow-300',
          '[&_hr]:border-ink-600 [&_hr]:my-3',
          '[&_input]:border-ink-600 [&_input]:bg-ink-900 [&_input]:text-ink-200 [&_input]:rounded [&_input]:border [&_input]:px-1',
          fitWidth ? 'nomad-micron-page--fit-width' : null,
        ]
          .filter(Boolean)
          .join(' ')}
      />
    </div>
  );
}
