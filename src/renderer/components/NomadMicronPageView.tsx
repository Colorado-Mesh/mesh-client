import { useCallback, useEffect, useRef } from 'react';

import {
  buildNomadLinkRequest,
  isExternalHttpUrl,
  isNomadFilePath,
  mountNomadMicronHtml,
  parseNomadNetworkLinkUrl,
  renderNomadMicronPage,
} from '@/renderer/lib/nomad/micronParser';
import {
  isReticulumLxmfLink,
  parseReticulumLxmfLinkUrl,
} from '@/renderer/lib/reticulum/reticulumDestinationInput';

interface NomadMicronPageViewProps {
  content: string;
  defaultPagePath: string;
  selectedHash: string;
  onNavigate: (hash: string, path: string, requestData?: Record<string, string>) => void;
  onDownloadFile: (hash: string, path: string) => void;
  onOpenDm?: (destinationHash: string) => void;
}

export default function NomadMicronPageView({
  content,
  defaultPagePath,
  selectedHash,
  onNavigate,
  onDownloadFile,
  onOpenDm,
}: NomadMicronPageViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleNomadLink = useCallback(
    (destination: string, dataFieldsAttr?: string | null) => {
      if (isExternalHttpUrl(destination)) {
        window.open(destination, '_blank', 'noopener,noreferrer');
        return;
      }

      const lxmfHash = parseReticulumLxmfLinkUrl(destination);
      if (lxmfHash) {
        onOpenDm?.(lxmfHash);
        return;
      }

      const { destination: linkDest, requestData } = buildNomadLinkRequest(
        destination,
        dataFieldsAttr,
        containerRef.current,
      );

      const parsed = parseNomadNetworkLinkUrl(linkDest, defaultPagePath);
      if (!parsed) return;

      const hash = parsed.destination_hash ?? selectedHash;
      if (isNomadFilePath(parsed.path)) {
        onDownloadFile(hash, parsed.path);
        return;
      }
      onNavigate(hash, parsed.path, Object.keys(requestData).length > 0 ? requestData : undefined);
    },
    [defaultPagePath, onDownloadFile, onNavigate, onOpenDm, selectedHash],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    mountNomadMicronHtml(container, renderNomadMicronPage(content));

    const links = container.querySelectorAll<HTMLElement>('[data-action="openNode"]');
    const cleanups: (() => void)[] = [];
    for (const element of links) {
      const onActivate = (event: Event) => {
        event.preventDefault();
        const href = element.getAttribute('href') ?? '';
        const title = element.getAttribute('title') ?? '';
        const dataDestination = element.getAttribute('data-destination') ?? '';
        // micron-parser strips lxmf:// from data-destination; href/title keep the scheme.
        const lxmfSource = [href, title].find((v) => v && isReticulumLxmfLink(v));
        const destination = (lxmfSource ?? dataDestination) || href;
        if (!destination) return;
        const dataFields = element.getAttribute('data-fields');
        handleNomadLink(destination, dataFields);
      };
      element.addEventListener('click', onActivate);
      cleanups.push(() => {
        element.removeEventListener('click', onActivate);
      });
    }
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [content, handleNomadLink]);

  return (
    <div
      ref={containerRef}
      className="nomad-micron-page text-sm leading-snug text-gray-200 [&_a]:text-amber-400 [&_a]:underline [&_a:hover]:text-amber-300 [&_hr]:my-3 [&_hr]:border-gray-600 [&_input]:rounded [&_input]:border [&_input]:border-gray-600 [&_input]:bg-slate-900 [&_input]:px-1 [&_input]:text-gray-200"
    />
  );
}
