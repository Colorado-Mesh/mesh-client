import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { APP_SETTINGS_STORAGE_KEY } from '@/renderer/lib/appSettingsStorage';
import type {
  DiscoveredMeshcoreRegion,
  MeshcoreRegionDiscoveryProgress,
  MeshcoreRegionDiscoveryRun,
} from '@/renderer/lib/meshcoreRegionDiscovery';
import { MESHCORE_DISCOVERED_REGIONS_STALE_MS } from '@/renderer/lib/meshcoreRegionDiscoveryStorage';

import { MeshcoreFloodScopeSection } from './MeshcoreFloodScopeSection';

type DiscoveryRunResult = MeshcoreRegionDiscoveryRun & {
  skipped: readonly { nodeId: number; reason: 'no-pubkey' }[];
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const hashtag = typeof opts?.hashtag === 'string' ? opts.hashtag : '';
      const message = typeof opts?.message === 'string' ? opts.message : '';
      const region = typeof opts?.region === 'string' ? opts.region : '';
      const count = typeof opts?.count === 'number' ? opts.count : '';
      const done = typeof opts?.done === 'number' ? opts.done : '';
      const total = typeof opts?.total === 'number' ? opts.total : '';
      const name = typeof opts?.name === 'string' ? opts.name : '';
      const when = typeof opts?.when === 'string' ? opts.when : '';
      const added = typeof opts?.added === 'number' ? opts.added : '';
      const map: Record<string, string> = {
        'radioPanel.floodScopeHelp': 'Flood scope help',
        'radioPanel.floodScopeTitle': 'Regional flood scope',
        'radioPanel.floodScopeNone': 'None (clear scope)',
        'radioPanel.floodScopeSaved': 'Saved scope',
        'radioPanel.floodScopeSavedSelect': 'Saved region hashtag',
        'radioPanel.floodScopeSavedEmpty': 'No saved scopes yet.',
        'radioPanel.floodScopeRemoveSaved': 'Remove from saved scopes',
        'radioPanel.floodScopeRemoveSavedAria': `Remove ${hashtag} from saved scopes`,
        'radioPanel.floodScopeAddHashtag': 'Region hashtag to save',
        'radioPanel.floodScopeAddSaved': 'Save region',
        'radioPanel.floodScopePresetsTitle': 'Saved regions',
        'radioPanel.floodScopePresetsHelp': 'Presets help',
        'radioPanel.floodScopePresetsFull': 'Saved region list is full',
        'radioPanel.floodScopeInvalidHashtag': 'Enter a valid region hashtag',
        'radioPanel.floodScopeCustom': 'Custom hashtag',
        'radioPanel.floodScopeCustomPlaceholder': '#metro',
        'radioPanel.floodScopeApply': 'Apply flood scope',
        'radioPanel.floodScopeApplySuccess': 'Flood scope applied',
        'radioPanel.floodScopeApplyFailed': `Flood scope failed: ${message}`,
        'radioPanel.floodScopeDiscover': 'Discover regions',
        'radioPanel.floodScopeDiscoverTitle': 'Discovered regions',
        'radioPanel.floodScopeDiscoverHelp': 'Discover help',
        'radioPanel.floodScopeDiscoverBusy': `Discovering ${done}/${total} (${name})…`,
        'radioPanel.floodScopeDiscoverCancel': 'Cancel discovery',
        'radioPanel.floodScopeDiscoverCancelled': 'Discovery stopped.',
        'radioPanel.floodScopeDiscoverEmpty': 'No regions discovered yet.',
        'radioPanel.floodScopeDiscoverNone': 'No public regions reported.',
        'radioPanel.floodScopeDiscoverSave': 'Save',
        'radioPanel.floodScopeDiscoverSaveAria': `Save ${region} as a scope preset`,
        'radioPanel.floodScopeDiscoverSaved': 'Saved',
        'radioPanel.floodScopeDiscoverSelect': 'Select',
        'radioPanel.floodScopeDiscoverSelectAria': `Select ${region} for the radio scope`,
        'radioPanel.floodScopeDiscoverSelected': `Selected ${region}. Press Apply to set the radio scope.`,
        'radioPanel.floodScopeDiscoverAddAll': `Add all public (${count})`,
        'radioPanel.floodScopeDiscoverAddAllClipped': `Added ${added} of ${total}; the saved scope list is full.`,
        'radioPanel.floodScopeDiscoverPrivate': 'Private (not hashtag-addressable)',
        'radioPanel.floodScopeDiscoverHome': 'Home',
        'radioPanel.floodScopeDiscoverFloodAllowed': 'Flood allowed',
        'radioPanel.floodScopeDiscoverFloodDenied': 'Flood denied',
        'radioPanel.floodScopeDiscoverSources': `Reported by ${count} repeaters`,
        'radioPanel.floodScopeDiscoverTruncated': `${count} region lists were truncated by firmware; some names may be missing.`,
        'radioPanel.floodScopeDiscoverSkipped': `${count} repeaters skipped (no public key).`,
        'radioPanel.floodScopeDiscoverFailed': `${count} repeaters did not respond.`,
        'radioPanel.floodScopeDiscoverFail.unsupported': 'regions not supported',
        'radioPanel.floodScopeDiscoverFail.rejected': 'request rejected',
        'radioPanel.floodScopeDiscoverFail.invalid-reply': 'invalid reply',
        'radioPanel.floodScopeDiscoverFail.timeout': 'timed out',
        'radioPanel.floodScopeDiscoverFail.unreachable': 'unreachable',
        'radioPanel.floodScopeDiscoverFail.unknown': 'unknown error',
        'radioPanel.floodScopeDiscoverStale': `Last discovered ${when}`,
        'radioPanel.floodScopeDiscoverError':
          'Region discovery failed. Try again or check the Repeaters tab.',
        'common.saving': 'Saving…',
        'common.justNow': 'just now',
        'common.never': 'never',
        'common.minutesAgo': `${count} minutes ago`,
        'common.hoursAgo': `${count} hours ago`,
      };
      return map[key] ?? key;
    },
  }),
}));

const publicRegion: DiscoveredMeshcoreRegion = {
  name: 'us-tn-tri',
  scopeHashtag: '#us-tn-tri',
  depth: 3,
  home: false,
  floodAllowed: true,
  sources: [18, 42],
};

const privateRegion: DiscoveredMeshcoreRegion = {
  name: '$private',
  scopeHashtag: null,
  depth: 1,
  home: false,
  floodAllowed: false,
  sources: [18],
};

describe('MeshcoreFloodScopeSection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('applies a saved flood scope in standalone mode', async () => {
    const onApplyFloodScope = vi.fn().mockResolvedValue(undefined);
    const onSavedPresetsChange = vi.fn();
    render(
      <MeshcoreFloodScopeSection
        disabled={false}
        isConnected
        savedHashtag=""
        savedPresets={['#eu']}
        onSavedPresetsChange={onSavedPresetsChange}
        onApplyFloodScope={onApplyFloodScope}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /Saved scope/i }));
    fireEvent.click(screen.getByRole('button', { name: /Apply flood scope/i }));

    await waitFor(() => {
      expect(onApplyFloodScope).toHaveBeenCalledWith('#eu');
    });
    expect(onSavedPresetsChange).not.toHaveBeenCalled();
  });

  it('disables Saved when the list is empty', () => {
    render(
      <MeshcoreFloodScopeSection
        disabled={false}
        isConnected
        savedHashtag=""
        savedPresets={[]}
        onSavedPresetsChange={vi.fn()}
        onApplyFloodScope={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: /Saved scope/i })).toBeDisabled();
  });

  it('auto-adds a custom hashtag after successful apply', async () => {
    const onApplyFloodScope = vi.fn().mockResolvedValue(undefined);
    const onSavedPresetsChange = vi.fn();
    render(
      <MeshcoreFloodScopeSection
        disabled={false}
        isConnected
        savedHashtag=""
        savedPresets={[]}
        onSavedPresetsChange={onSavedPresetsChange}
        onApplyFloodScope={onApplyFloodScope}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /Custom hashtag/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /Custom hashtag/i }), {
      target: { value: 'tokyo' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Apply flood scope/i }));

    await waitFor(() => {
      expect(onApplyFloodScope).toHaveBeenCalledWith('#tokyo');
    });
    expect(onSavedPresetsChange).toHaveBeenCalledWith(['#tokyo']);
    const parsed = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(parsed.meshcoreFloodScopePresets).toEqual(['#tokyo']);
  });

  it('does not auto-add when apply fails', async () => {
    const onApplyFloodScope = vi.fn().mockRejectedValue(new Error('radio offline'));
    const onSavedPresetsChange = vi.fn();
    render(
      <MeshcoreFloodScopeSection
        disabled={false}
        isConnected
        savedHashtag=""
        savedPresets={[]}
        onSavedPresetsChange={onSavedPresetsChange}
        onApplyFloodScope={onApplyFloodScope}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /Custom hashtag/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /Custom hashtag/i }), {
      target: { value: '#fail' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Apply flood scope/i }));

    await waitFor(() => {
      expect(screen.getByText(/radio offline/)).toBeInTheDocument();
    });
    expect(onSavedPresetsChange).not.toHaveBeenCalled();
  });

  it('removes a saved scope without clearing the radio hashtag', () => {
    const onSavedHashtagChange = vi.fn();
    const onSavedPresetsChange = vi.fn();
    render(
      <MeshcoreFloodScopeSection
        disabled={false}
        isConnected
        savedHashtag="#eu"
        savedPresets={['#eu', '#jp']}
        onSavedPresetsChange={onSavedPresetsChange}
        onApplyFloodScope={vi.fn()}
        onSavedHashtagChange={onSavedHashtagChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Remove #eu from saved scopes/i }));
    expect(onSavedPresetsChange).toHaveBeenCalledWith(['#jp']);
    expect(onSavedHashtagChange).not.toHaveBeenCalled();
  });

  it('embedded mode omits standalone apply button', () => {
    render(
      <MeshcoreFloodScopeSection
        embedded
        disabled={false}
        isConnected
        savedHashtag="#mesh"
        savedPresets={['#mesh']}
        onSavedPresetsChange={vi.fn()}
        onApplyFloodScope={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Apply flood scope/i })).not.toBeInTheDocument();
  });

  it.each(['linux', 'darwin', 'win32'] as const)(
    'saves and removes presets while disconnected without applying a radio default on %s',
    (platform) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
      const onApplyFloodScope = vi.fn();
      const onSavedHashtagChange = vi.fn();
      const onSavedPresetsChange = vi.fn();
      render(
        <MeshcoreFloodScopeSection
          disabled
          isConnected={false}
          savedHashtag="#us-southeast"
          savedPresets={['#us-tn']}
          onSavedPresetsChange={onSavedPresetsChange}
          onApplyFloodScope={onApplyFloodScope}
          onSavedHashtagChange={onSavedHashtagChange}
        />,
      );
      fireEvent.change(screen.getByRole('textbox', { name: 'Region hashtag to save' }), {
        target: { value: 'us-tn-tri' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save region' }));
      expect(onSavedPresetsChange).toHaveBeenLastCalledWith(['#us-tn', '#us-tn-tri']);
      fireEvent.click(screen.getByRole('button', { name: 'Remove #us-tn from saved scopes' }));
      expect(onSavedPresetsChange).toHaveBeenLastCalledWith([]);
      expect(onApplyFloodScope).not.toHaveBeenCalled();
      expect(onSavedHashtagChange).not.toHaveBeenCalled();
      const settings = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
        string,
        unknown
      >;
      expect(settings.meshcoreFloodScopeHashtag).toBeUndefined();
    },
  );

  it.each([
    { presets: ['#us-tn'], draft: '#', error: 'Enter a valid region hashtag' },
    {
      presets: Array.from({ length: 20 }, (_, i) => `#region-${i}`),
      draft: '#extra',
      error: 'Saved region list is full',
    },
  ])(
    'refuses an invalid or overflowing preset without removing saved entries',
    ({ presets, draft, error }) => {
      const onSavedPresetsChange = vi.fn();
      render(
        <MeshcoreFloodScopeSection
          disabled={false}
          isConnected
          savedHashtag=""
          savedPresets={presets}
          onSavedPresetsChange={onSavedPresetsChange}
          onApplyFloodScope={vi.fn()}
        />,
      );
      fireEvent.change(screen.getByRole('textbox', { name: 'Region hashtag to save' }), {
        target: { value: draft },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save region' }));
      expect(screen.getByRole('alert')).toHaveTextContent(error);
      expect(onSavedPresetsChange).not.toHaveBeenCalled();
    },
  );

  it('disables Discover when offline', () => {
    render(
      <MeshcoreFloodScopeSection
        disabled={false}
        isConnected={false}
        savedHashtag=""
        savedPresets={[]}
        onSavedPresetsChange={vi.fn()}
        onApplyFloodScope={vi.fn()}
        onDiscoverRegions={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Discover regions' })).toBeDisabled();
  });

  it('shows progress and Cancel while discovering', async () => {
    let resolveRun: ((value: DiscoveryRunResult) => void) | undefined;
    const onDiscoverRegions = vi.fn(
      (
        _signal: AbortSignal,
        onProgress: (progress: MeshcoreRegionDiscoveryProgress) => void,
      ): Promise<DiscoveryRunResult> => {
        onProgress({ done: 1, total: 3, nodeId: 2, name: 'Mid' });
        return new Promise((resolve) => {
          resolveRun = resolve;
        });
      },
    );
    render(
      <MeshcoreFloodScopeSection
        disabled={false}
        isConnected
        savedHashtag=""
        savedPresets={[]}
        onSavedPresetsChange={vi.fn()}
        onApplyFloodScope={vi.fn()}
        onDiscoverRegions={onDiscoverRegions}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discover regions' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Discovering 1/3 (Mid)');
    expect(screen.getByRole('button', { name: 'Cancel discovery' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discover regions' })).toBeDisabled();
    resolveRun?.({
      entries: [publicRegion],
      readAt: Date.now(),
      truncatedSources: [],
      skipped: [],
      failed: [],
      cancelled: false,
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Cancel discovery' })).not.toBeInTheDocument();
    });
  });

  it('saves a discovered public region and does not apply on Select', () => {
    const onApplyFloodScope = vi.fn();
    const onSavedPresetsChange = vi.fn();
    render(
      <MeshcoreFloodScopeSection
        disabled={false}
        isConnected
        savedHashtag=""
        savedPresets={[]}
        onSavedPresetsChange={onSavedPresetsChange}
        onApplyFloodScope={onApplyFloodScope}
        discoveredRegions={[publicRegion, privateRegion]}
        discoveredRegionsReadAt={Date.now()}
        onDiscoverRegions={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save #us-tn-tri as a scope preset' }));
    expect(onSavedPresetsChange).toHaveBeenCalledWith(['#us-tn-tri']);

    fireEvent.click(screen.getByRole('button', { name: 'Select #us-tn-tri for the radio scope' }));
    expect(onApplyFloodScope).not.toHaveBeenCalled();
    expect(screen.getByText(/Selected #us-tn-tri/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Custom hashtag/i })).toHaveValue('#us-tn-tri');
    expect(screen.queryByRole('button', { name: /Save \$private/i })).not.toBeInTheDocument();
  });

  it('shows truncated skipped and failed summaries', () => {
    render(
      <MeshcoreFloodScopeSection
        disabled={false}
        isConnected
        savedHashtag=""
        savedPresets={[]}
        onSavedPresetsChange={vi.fn()}
        onApplyFloodScope={vi.fn()}
        discoveredRegions={[publicRegion]}
        discoveredRegionsReadAt={Date.now() - MESHCORE_DISCOVERED_REGIONS_STALE_MS - 1}
        onDiscoverRegions={() =>
          Promise.resolve({
            entries: [publicRegion],
            readAt: Date.now(),
            truncatedSources: [42],
            skipped: [{ nodeId: 9, reason: 'no-pubkey' as const }],
            failed: [{ nodeId: 7, reason: 'timeout' as const }],
            cancelled: false,
          })
        }
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discover regions' }));
    return waitFor(() => {
      expect(screen.getByText(/truncated by firmware/i)).toBeInTheDocument();
      expect(screen.getByText(/skipped \(no public key\)/i)).toBeInTheDocument();
      expect(screen.getByText(/did not respond/i)).toBeInTheDocument();
      expect(screen.getByText(/7: timed out/i)).toBeInTheDocument();
    });
  });

  it('renders discovery errors with alert role', async () => {
    render(
      <MeshcoreFloodScopeSection
        disabled={false}
        isConnected
        savedHashtag=""
        savedPresets={[]}
        onSavedPresetsChange={vi.fn()}
        onApplyFloodScope={vi.fn()}
        onDiscoverRegions={() => Promise.reject(new Error('boom'))}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discover regions' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Region discovery failed/);
  });

  it('aborts discovery when Cancel is pressed', async () => {
    let observedAbort = false;
    const onDiscoverRegions = vi.fn(
      (signal: AbortSignal, onProgress: (progress: MeshcoreRegionDiscoveryProgress) => void) => {
        expect(typeof onProgress).toBe('function');
        return new Promise<DiscoveryRunResult>((resolve) => {
          signal.addEventListener('abort', () => {
            observedAbort = true;
            resolve({
              entries: [publicRegion],
              readAt: Date.now(),
              truncatedSources: [],
              skipped: [],
              failed: [],
              cancelled: true,
            });
          });
        });
      },
    );
    render(
      <MeshcoreFloodScopeSection
        disabled={false}
        isConnected
        savedHashtag=""
        savedPresets={[]}
        onSavedPresetsChange={vi.fn()}
        onApplyFloodScope={vi.fn()}
        onDiscoverRegions={onDiscoverRegions}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discover regions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel discovery' }));
    await waitFor(() => {
      expect(observedAbort).toBe(true);
      expect(screen.getByText('Discovery stopped.')).toBeInTheDocument();
    });
  });

  it('has no axe violations with discovery controls', async () => {
    const { container } = render(
      <MeshcoreFloodScopeSection
        disabled={false}
        isConnected
        savedHashtag="#us-southeast"
        savedPresets={['#us-tn']}
        onSavedPresetsChange={vi.fn()}
        onApplyFloodScope={vi.fn()}
        discoveredRegions={[publicRegion, privateRegion]}
        discoveredRegionsReadAt={Date.now()}
        onDiscoverRegions={vi.fn()}
      />,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations with the saved-region controls enabled', async () => {
    const { container } = render(
      <MeshcoreFloodScopeSection
        disabled={false}
        isConnected
        savedHashtag="#us-southeast"
        savedPresets={['#us-tn']}
        onSavedPresetsChange={vi.fn()}
        onApplyFloodScope={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Region hashtag to save' }), {
      target: { value: '#us-tn-tri' },
    });
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
