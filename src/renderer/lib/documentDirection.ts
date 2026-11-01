import { getTextDirection } from '../locales/languages';

/**
 * Mirror the active UI language onto `<html lang dir>` so Tailwind logical utilities
 * (`ps-*`, `text-start`, `border-e`, …) and native controls flip for RTL locales.
 * No-op outside a DOM (node-environment tests, workers).
 */
export function applyDocumentDirection(code: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dir = getTextDirection(code);
  if (code) root.lang = code;
}
