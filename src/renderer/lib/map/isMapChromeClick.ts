/**
 * True when a Leaflet map click originated from chrome (controls, buttons, form
 * widgets) rather than the map surface. Used to keep overlay click handlers from
 * reacting to locate/measure/layers UI.
 */
export function isMapChromeClick(originalEvent: Event | undefined): boolean {
  const target = originalEvent?.target;
  if (!target || typeof (target as Element).closest !== 'function') return false;
  return Boolean(
    (target as Element).closest(
      [
        'button',
        'a',
        'input',
        'select',
        'textarea',
        'label',
        '.leaflet-control',
        '.leaflet-control-container',
        '[role="button"]',
        '[role="dialog"]',
      ].join(', '),
    ),
  );
}
