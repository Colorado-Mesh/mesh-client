/** Node detail modal — must sit above map panels (Leaflet panes ~650). */
export const Z_NODE_DETAIL_MODAL = 10_000;

/** Nested auth overlays opened from NodeDetailModal — must sit above the node modal. */
export const Z_NESTED_AUTH_OVERLAY = 10_001;

/** Instant tooltips (portal) — must sit above node/peer detail modals and nested auth. */
export const Z_INSTANT_TOOLTIP = 10_100;
