import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { MESHCORE_AUTO_ADD_OVERWRITE_OLDEST } from '../lib/meshcoreContactAutoAdd';
import { enrichMeshCoreSelfInfo } from '../lib/meshcoreTelemetryPrivacy';
import { renderWithToast } from '../lib/testRenderHelpers';
import MeshcoreContactSettingsSection from './MeshcoreContactSettingsSection';

function minimalSelfInfo(manualAddContacts: boolean) {
  return enrichMeshCoreSelfInfo({
    name: 'Test',
    publicKey: new Uint8Array(32).fill(0xab),
    type: 0,
    txPower: 10,
    advLat: 0,
    advLon: 0,
    radioFreq: 900_000_000,
    manualAddContacts,
  });
}

describe('MeshcoreContactSettingsSection', () => {
  it('invokes onApply with autoAddAll false after switching to Auto add selected', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn().mockResolvedValue(undefined);
    renderWithToast(
      <MeshcoreContactSettingsSection
        selfInfo={minimalSelfInfo(false)}
        autoadd={{ autoaddConfig: 0, autoaddMaxHops: 0 }}
        disabled={false}
        applying={false}
        meshcoreContactsShowPublicKeys={false}
        onMeshcoreContactsShowPublicKeysChange={vi.fn()}
        meshcoreContactsShowRefreshControl={false}
        onMeshcoreContactsShowRefreshControlChange={vi.fn()}
        meshcoreAutoOffloadWhenFull={false}
        onMeshcoreAutoOffloadWhenFullChange={vi.fn()}
        onApply={onApply}
      />,
    );

    await user.click(screen.getByText('Contact management'));
    await user.click(screen.getByRole('radio', { name: /Auto add selected/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toMatchObject({
      autoAddAll: false,
      maxHopsWire: 0,
    });
  });

  it('calls onClearAllContacts after confirm', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onClearAllContacts = vi.fn().mockResolvedValue(undefined);

    renderWithToast(
      <MeshcoreContactSettingsSection
        selfInfo={minimalSelfInfo(false)}
        autoadd={{ autoaddConfig: 0, autoaddMaxHops: 0 }}
        disabled={false}
        applying={false}
        meshcoreContactsShowPublicKeys={false}
        onMeshcoreContactsShowPublicKeysChange={vi.fn()}
        meshcoreContactsShowRefreshControl={false}
        onMeshcoreContactsShowRefreshControlChange={vi.fn()}
        meshcoreAutoOffloadWhenFull={false}
        onMeshcoreAutoOffloadWhenFullChange={vi.fn()}
        onApply={vi.fn().mockResolvedValue(undefined)}
        onClearAllContacts={onClearAllContacts}
      />,
    );

    await user.click(screen.getByText('Contact management'));
    await user.click(screen.getByRole('button', { name: 'Clear all MeshCore contacts' }));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(onClearAllContacts).toHaveBeenCalledTimes(1);
    });
    confirmSpy.mockRestore();
  });
});

describe('MeshcoreContactSettingsSection overwrite-oldest note', () => {
  function renderSection(opts: { overwriteOldest: boolean; autoOffload: boolean }) {
    return renderWithToast(
      <MeshcoreContactSettingsSection
        selfInfo={minimalSelfInfo(false)}
        autoadd={{
          autoaddConfig: opts.overwriteOldest ? MESHCORE_AUTO_ADD_OVERWRITE_OLDEST : 0,
          autoaddMaxHops: 0,
        }}
        disabled={false}
        applying={false}
        meshcoreContactsShowPublicKeys={false}
        onMeshcoreContactsShowPublicKeysChange={vi.fn()}
        meshcoreContactsShowRefreshControl={false}
        onMeshcoreContactsShowRefreshControlChange={vi.fn()}
        meshcoreAutoOffloadWhenFull={opts.autoOffload}
        onMeshcoreAutoOffloadWhenFullChange={vi.fn()}
        onApply={vi.fn()}
      />,
    );
  }

  it.each([
    { overwriteOldest: false, autoOffload: false },
    { overwriteOldest: true, autoOffload: false },
    { overwriteOldest: false, autoOffload: true },
  ])('hides the note when not both on (%o)', (opts) => {
    renderSection(opts);
    expect(screen.queryByTestId('meshcore-overwrite-oldest-evicts-note')).not.toBeInTheDocument();
  });

  it('shows the note when overwrite-oldest and auto-offload are both on, with no axe violations', async () => {
    const { container } = renderSection({ overwriteOldest: true, autoOffload: true });
    expect(screen.getByTestId('meshcore-overwrite-oldest-evicts-note')).toHaveTextContent(
      /Overwrite oldest is also on/,
    );
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('MeshcoreContactSettingsSection consistency', () => {
  it('details element has group class for chevron animation', () => {
    renderWithToast(
      <MeshcoreContactSettingsSection
        selfInfo={minimalSelfInfo(false)}
        autoadd={{ autoaddConfig: 0, autoaddMaxHops: 0 }}
        disabled={false}
        applying={false}
        meshcoreContactsShowPublicKeys={false}
        onMeshcoreContactsShowPublicKeysChange={vi.fn()}
        meshcoreContactsShowRefreshControl={false}
        onMeshcoreContactsShowRefreshControlChange={vi.fn()}
        meshcoreAutoOffloadWhenFull={false}
        onMeshcoreAutoOffloadWhenFullChange={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    const details = document.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.classList.contains('group')).toBe(true);
  });

  it('summary element contains SVG chevron for consistent dropdown marker', () => {
    renderWithToast(
      <MeshcoreContactSettingsSection
        selfInfo={minimalSelfInfo(false)}
        autoadd={{ autoaddConfig: 0, autoaddMaxHops: 0 }}
        disabled={false}
        applying={false}
        meshcoreContactsShowPublicKeys={false}
        onMeshcoreContactsShowPublicKeysChange={vi.fn()}
        meshcoreContactsShowRefreshControl={false}
        onMeshcoreContactsShowRefreshControlChange={vi.fn()}
        meshcoreAutoOffloadWhenFull={false}
        onMeshcoreAutoOffloadWhenFullChange={vi.fn()}
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
      <MeshcoreContactSettingsSection
        selfInfo={minimalSelfInfo(false)}
        autoadd={{ autoaddConfig: 0, autoaddMaxHops: 0 }}
        disabled={false}
        applying={false}
        meshcoreContactsShowPublicKeys={false}
        onMeshcoreContactsShowPublicKeysChange={vi.fn()}
        meshcoreContactsShowRefreshControl={false}
        onMeshcoreContactsShowRefreshControlChange={vi.fn()}
        meshcoreAutoOffloadWhenFull={false}
        onMeshcoreAutoOffloadWhenFullChange={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
