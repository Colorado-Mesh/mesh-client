import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { enrichMeshCoreSelfInfo } from '../lib/meshcoreTelemetryPrivacy';
import { renderWithToast } from '../lib/testRenderHelpers';
import MeshcoreTelemetryPrivacySection from './MeshcoreTelemetryPrivacySection';

function minimalSelfInfo() {
  return enrichMeshCoreSelfInfo({
    name: 'Test',
    publicKey: new Uint8Array(32).fill(0xab),
    type: 0,
    txPower: 10,
    advLat: 0,
    advLon: 0,
    radioFreq: 900_000_000,
    manualAddContacts: false,
  });
}

describe('MeshcoreTelemetryPrivacySection consistency', () => {
  it('details element has group class for chevron animation', () => {
    renderWithToast(
      <MeshcoreTelemetryPrivacySection
        selfInfo={minimalSelfInfo()}
        contacts={[]}
        disabled={false}
        applying={false}
        onApply={vi.fn()}
      />,
    );

    const details = document.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.classList.contains('group')).toBe(true);
  });

  it('summary element contains SVG chevron for consistent dropdown marker', () => {
    renderWithToast(
      <MeshcoreTelemetryPrivacySection
        selfInfo={minimalSelfInfo()}
        contacts={[]}
        disabled={false}
        applying={false}
        onApply={vi.fn()}
      />,
    );

    const summary = document.querySelector('summary');
    expect(summary).not.toBeNull();
    const svg = summary?.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains('group-open:rotate-180')).toBe(true);
  });

  it('has no axe violations', async () => {
    const { container } = renderWithToast(
      <MeshcoreTelemetryPrivacySection
        selfInfo={minimalSelfInfo()}
        contacts={[]}
        disabled={false}
        applying={false}
        onApply={vi.fn()}
      />,
    );
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
