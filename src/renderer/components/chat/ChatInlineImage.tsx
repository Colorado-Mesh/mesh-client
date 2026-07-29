import type { ReactNode } from 'react';
import { useState } from 'react';

/** Shared Tailwind for large chat inline raster embeds (link previews, attachments, GIFs). */
export const CHAT_INLINE_IMAGE_CLASS =
  'max-h-64 max-w-full rounded-md border border-cyan-500/20 object-contain';

export interface ChatInlineImageProps {
  src: string;
  alt: string;
  /** When set, wraps the image in an external link. */
  href?: string;
  title?: string;
  onContentResize?: () => void;
  /** Called after the image fails to load (component hides itself). */
  onError?: () => void;
  /** Fallback when the image fails (e.g. MeshCore GIF wire text). */
  fallback?: ReactNode;
}

/** Large inline `<img>` with load/error handling shared by Chat embeds. */
export function ChatInlineImage({
  src,
  alt,
  href,
  title,
  onContentResize,
  onError,
  fallback,
}: ChatInlineImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return fallback ? <>{fallback}</> : null;
  }

  const img = (
    <img
      src={src}
      alt={alt}
      className={CHAT_INLINE_IMAGE_CLASS}
      onLoad={() => {
        onContentResize?.();
      }}
      onError={() => {
        setFailed(true);
        onError?.();
      }}
    />
  );

  if (!href) return img;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mt-2 inline-block max-w-xs"
      title={title}
    >
      {img}
    </a>
  );
}
