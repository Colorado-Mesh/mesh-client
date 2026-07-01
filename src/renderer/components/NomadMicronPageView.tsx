import { useCallback, useEffect, useRef } from 'react';

import {
  isExternalHttpUrl,
  isNomadFilePath,
  mountNomadMicronHtml,
  parseNomadNetworkLinkUrl,
  renderNomadMicronPage,
} from '@/renderer/lib/nomad/micronParser';

interface NomadMicronPageViewProps {
  content: string;
  defaultPagePath: string;
  selectedHash: string;
  onNavigate: (hash: string, path: string) => void;
  onDownloadFile: (hash: string, path: string) => void;
}

export default function NomadMicronPageView({
  content,
  defaultPagePath,
  selectedHash,
  onNavigate,
  onDownloadFile,
}: NomadMicronPageViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleNomadLink = useCallback(
    (destination: string) => {
      if (isExternalHttpUrl(destination)) {
        window.open(destination, '_blank', 'noopener,noreferrer');
        return;
      }

      const parsed = parseNomadNetworkLinkUrl(destination, defaultPagePath);
      if (!parsed) return;

      const hash = parsed.destination_hash ?? selectedHash;
      if (isNomadFilePath(parsed.path)) {
        onDownloadFile(hash, parsed.path);
        return;
      }
      onNavigate(hash, parsed.path);
    },
    [defaultPagePath, onDownloadFile, onNavigate, selectedHash],
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
        const destination =
          element.getAttribute('data-destination') ?? element.getAttribute('href') ?? '';
        if (!destination) return;
        handleNomadLink(destination);
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
      className="nomad-micron-page text-sm leading-relaxed text-gray-200 [&_a]:text-amber-400 [&_a]:underline [&_a:hover]:text-amber-300 [&_hr]:my-3 [&_hr]:border-gray-600"
    />
  );
}
