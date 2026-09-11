import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';

import { isExternalHttpUrl, mountNomadMicronHtml } from '@/renderer/lib/nomad/micronParser';
import { openNomadPageFromLink } from '@/renderer/lib/nomad/openNomadPageFromLink';
import { openRrcHubFromLink } from '@/renderer/lib/openRrcHubFromLink';
import {
  isReticulumLxmfLink,
  parseReticulumLxmfLinkUrl,
} from '@/renderer/lib/reticulum/reticulumDestinationInput';
import { renderRrcFormattedBodyHtml, rrcBodyLooksFormatted } from '@/renderer/lib/rrcFormattedBody';
import { isRrcLink } from '@/renderer/lib/rrcLink';

interface RrcFormattedBodyProps {
  text: string;
  /** Fallback when the body is plain IRC text (mentions + linkify). */
  fallback: ReactNode;
  onOpenDm?: (destinationHash: string) => void;
}

/**
 * Renders micron/markdown RRC bodies via the shared Nomad micron path (XSS-safe).
 * Plain text keeps the existing mention/linkify fallback.
 */
export function RrcFormattedBody({ text, fallback, onOpenDm }: RrcFormattedBodyProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const onOpenDmRef = useRef(onOpenDm);
  useLayoutEffect(() => {
    onOpenDmRef.current = onOpenDm;
  }, [onOpenDm]);

  const formatted = rrcBodyLooksFormatted(text);

  useEffect(() => {
    if (!formatted) return;
    const el = ref.current;
    if (!el) return;
    mountNomadMicronHtml(el, renderRrcFormattedBodyHtml(text));

    const onActivate = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLElement>('a,[data-action="openNode"]');
      if (!link || !el.contains(link)) return;
      const href = link.getAttribute('href') ?? '';
      const title = link.getAttribute('title') ?? '';
      const dataDestination = link.getAttribute('data-destination') ?? '';
      if (href.startsWith('#') || dataDestination.startsWith('#')) return;

      const candidates = [href, title, dataDestination].filter(Boolean);
      const rrc = candidates.find((v) => isRrcLink(v));
      if (rrc) {
        event.preventDefault();
        openRrcHubFromLink(rrc);
        return;
      }
      const lxmf = candidates.find((v) => isReticulumLxmfLink(v));
      if (lxmf) {
        event.preventDefault();
        const hash = parseReticulumLxmfLinkUrl(lxmf);
        if (hash) onOpenDmRef.current?.(hash);
        return;
      }
      const http = candidates.find((v) => isExternalHttpUrl(v));
      if (http) {
        event.preventDefault();
        window.open(http, '_blank', 'noopener,noreferrer');
        return;
      }
      // Nomad page / bare hash destinations from micron links.
      const dest = dataDestination || href;
      if (dest && openNomadPageFromLink(dest)) {
        event.preventDefault();
      }
    };
    el.addEventListener('click', onActivate);
    return () => {
      el.removeEventListener('click', onActivate);
    };
  }, [formatted, text]);

  if (!formatted) return <>{fallback}</>;

  return (
    <span
      ref={ref}
      className="rrc-micron-body inline [&_a]:text-cyan-400 [&_a]:underline [&_a:hover]:text-cyan-300"
    />
  );
}
