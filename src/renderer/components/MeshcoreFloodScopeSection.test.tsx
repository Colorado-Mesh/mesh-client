import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { APP_SETTINGS_STORAGE_KEY } from '@/renderer/lib/appSettingsStorage';

import { MeshcoreFloodScopeSection } from './MeshcoreFloodScopeSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const hashtag = typeof opts?.hashtag === 'string' ? opts.hashtag : '';
      const message = typeof opts?.message === 'string' ? opts.message : '';
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
        'radioPanel.floodScopePresetsFull': 'Saved region list is full',
        'radioPanel.floodScopeInvalidHashtag': 'Enter a valid region hashtag',
        'radioPanel.floodScopeCustom': 'Custom hashtag',
        'radioPanel.floodScopeCustomPlaceholder': '#metro',
        'radioPanel.floodScopeApply': 'Apply flood scope',
        'radioPanel.floodScopeApplySuccess': 'Flood scope applied',
        'radioPanel.floodScopeApplyFailed': `Flood scope failed: ${message}`,
        'common.saving': 'Saving…',
      };
      return map[key] ?? key;
    },
  }),
}));

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
