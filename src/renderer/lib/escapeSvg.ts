import { escapeXmlAttr } from '../../shared/xmlEscape';

/** Escape a string for use in an SVG/HTML attribute value (double-quoted). */
export function escapeSvgAttr(s: string): string {
  return escapeXmlAttr(s);
}

/** Escape a string for use as SVG text content. */
