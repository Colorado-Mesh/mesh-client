import { describe, expect, it } from 'vitest';

import { Z_INSTANT_TOOLTIP, Z_NESTED_AUTH_OVERLAY, Z_NODE_DETAIL_MODAL } from './modalZIndex';

describe('modalZIndex', () => {
  it('keeps nested auth overlays above the node detail modal', () => {
    expect(Z_NESTED_AUTH_OVERLAY).toBeGreaterThan(Z_NODE_DETAIL_MODAL);
  });

  it('keeps instant tooltips above nested auth and node detail modals', () => {
    expect(Z_INSTANT_TOOLTIP).toBeGreaterThan(Z_NESTED_AUTH_OVERLAY);
    expect(Z_INSTANT_TOOLTIP).toBeGreaterThan(Z_NODE_DETAIL_MODAL);
  });
});
