import { escapeXmlAttr, escapeXmlText } from '../../shared/xmlEscape';

/** Escape a string for use in an SVG/HTML attribute value (double-quoted). */
export function escapeSvgAttr(s: string): string {
  return escapeXmlAttr(s);
}

/** Escape a string for use as SVG text content. */
export function escapeSvgText(s: string): string {
  return escapeXmlText(s);
}
