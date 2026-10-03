import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import {
  FLOOD_SCOPE_OVERRIDE_UNSCOPED,
  loadFloodScopeOverridesInitial,
  saveFloodScopeOverride,
} from '@/renderer/lib/chatPanelProtocolStorage';
import { meshcoreChannelScopeKey } from '@/renderer/lib/meshcoreChannelScope';
import { MESHCORE_CAPABILITIES } from '@/renderer/lib/radio/BaseRadioProvider';
import { withMockedConsoleWarn } from '@/renderer/lib/vitestConsoleMock';
import { classifyMeshClientDeepLink } from '@/shared/meshClientDeepLink';

import RadioPanel from './RadioPanel';
import { ToastProvider } from './Toast';

const signatures: Record<string, { signature: string }> = {
  radioA: { signature: 'meshcore:pk:' + 'a'.repeat(64) },
  radioB: { signature: 'meshcore:pk:' + 'b'.repeat(64) },
};
vi.mock('@/renderer/stores/identityStore', () => ({
  useIdentityStore: (selector: (s: { identities: typeof signatures }) => unknown) =>
    selector({ identities: signatures }),
}));
vi.mock('./QrCodeImage', () => ({
  default: ({ value, ariaLabel }: { value: string; ariaLabel: string }) => (
    <img alt={ariaLabel} data-qr-value={value} />
  ),
}));
vi.mock('./QrIngestControl', () => ({
  default: ({ onDecoded }: { onDecoded: (text: string) => void }) => (
    <button
      onClick={() => {
        onDecoded(
          'meshcore://channel/add?name=Imported&secret=' +
            'cc'.repeat(16) +
            '&mesh_client_scope=unscoped',
        );
      }}
    >
      Test QR import
    </button>
  ),
}));

const channel = { index: 1, name: 'Metro', secret: new Uint8Array(16).fill(12) };
const keyA = meshcoreChannelScopeKey(signatures.radioA.signature, channel)!;
const defaultProps = {
  onSetConfig: vi.fn(),
  onCommit: vi.fn(),
  onSetChannel: vi.fn(),
  onClearChannel: vi.fn(),
  channelConfigs: [],
  isConnected: true,
  onReboot: vi.fn(),
  onShutdown: vi.fn(),
  onFactoryReset: vi.fn(),
  onResetNodeDb: vi.fn(),
  capabilities: MESHCORE_CAPABILITIES,
  identityId: 'radioA',
  meshcoreChannels: [channel],
  meshcoreFloodScopeHashtag: '#us-co',
  meshcoreFloodScopePresets: ['#metro'],
};
function panel(props: Partial<React.ComponentProps<typeof RadioPanel>> = {}) {
  return (
    <ToastProvider>
      <RadioPanel {...defaultProps} {...props} />
    </ToastProvider>
  );
}
function openChannels() {
  const section = screen.getByText('Channels (MeshCore)').closest('details')!;
  if (!section.open) fireEvent.click(section.querySelector('summary')!);
  return within(section);
}
function stored() {
  return loadFloodScopeOverridesInitial('meshcore');
}

describe('MeshCore channel scope settings and QR', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each(['linux', 'darwin', 'win32'] as const)(
    'saves a named choice and shows its effective scope on %s',
    async (platform) => {
      window.electronAPI.getPlatform = () => platform;
      const save = vi.fn().mockResolvedValue(undefined);
      const { container } = render(panel({ onMeshcoreSetChannel: save }));
      const section = openChannels();
      fireEvent.click(section.getByRole('button', { name: 'Edit' }));
      expect(section.getByRole('combobox', { name: 'Send scope for this channel' })).toHaveValue(
        '',
      );
      fireEvent.change(section.getByRole('combobox', { name: 'Send scope for this channel' }), {
        target: { value: '#metro' },
      });
      expect(section.getByRole('status')).toHaveTextContent('Effective send scope: #metro');
      expect(stored()[keyA]).toBeUndefined();
      hydrateAxeThemeColors(container);
      expect(await axe(container)).toHaveNoViolations();
      fireEvent.click(section.getByRole('button', { name: 'Save' }));
      await waitFor(() => {
        expect(stored()[keyA]).toBe('#metro');
      });
      expect(save).toHaveBeenCalledWith(1, 'Metro', channel.secret);
      fireEvent.click(section.getByRole('button', { name: 'Show MeshCore channel QR for Metro' }));
      const uri = section.getByRole('img').getAttribute('data-qr-value')!;
      expect(classifyMeshClientDeepLink(uri)).toMatchObject({ regionScope: '#metro' });
    },
  );

  it('prefills explicit Unscoped through the in-panel QR handler, saving only after success', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('radio unavailable'))
      .mockResolvedValueOnce(undefined);
    render(panel({ onMeshcoreSetChannel: save }));
    const section = openChannels();
    fireEvent.click(section.getByRole('button', { name: 'Test QR import' }));
    expect(section.getByRole('combobox', { name: 'Send scope for this channel' })).toHaveValue(
      FLOOD_SCOPE_OVERRIDE_UNSCOPED,
    );
    expect(section.getByRole('status')).toHaveTextContent('Effective send scope: Unscoped');
    await withMockedConsoleWarn(async () => {
      fireEvent.click(section.getByRole('button', { name: 'Save' }));
      await waitFor(() => {
        expect(save).toHaveBeenCalledOnce();
      });
      await waitFor(() => {
        expect(section.getByRole('button', { name: 'Save' })).toBeEnabled();
      });
    });
    expect(stored()).toEqual({});
    fireEvent.click(section.getByRole('button', { name: 'Save' }));
    const importedKey = meshcoreChannelScopeKey(signatures.radioA.signature, {
      index: 0,
      name: 'Imported',
      secret: new Uint8Array(16).fill(204),
    })!;
    await waitFor(() => {
      expect(stored()[importedKey]).toBe(FLOOD_SCOPE_OVERRIDE_UNSCOPED);
    });
  });

  it('keeps drafts separate across radios and starts reused slots at Default', () => {
    saveFloodScopeOverride('meshcore', keyA, '#metro');
    const { rerender } = render(panel());
    let section = openChannels();
    fireEvent.click(section.getByRole('button', { name: 'Edit' }));
    expect(section.getByRole('combobox', { name: 'Send scope for this channel' })).toHaveValue(
      '#metro',
    );
    rerender(panel({ identityId: 'radioB' }));
    section = openChannels();
    expect(section.queryByRole('combobox', { name: 'Send scope for this channel' })).toBeNull();
    fireEvent.click(section.getByRole('button', { name: 'Edit' }));
    expect(section.getByRole('combobox', { name: 'Send scope for this channel' })).toHaveValue('');
    rerender(panel({ identityId: 'radioA', meshcoreChannels: [{ ...channel, name: 'Reused' }] }));
    section = openChannels();
    fireEvent.click(section.getByRole('button', { name: 'Edit' }));
    expect(section.getByRole('combobox', { name: 'Send scope for this channel' })).toHaveValue('');
    expect(stored()[keyA]).toBe('#metro');
  });

  it('does not persist a pending Save after switching radios', async () => {
    const keyB = meshcoreChannelScopeKey(signatures.radioB.signature, channel)!;
    saveFloodScopeOverride('meshcore', keyA, '#metro');
    saveFloodScopeOverride('meshcore', keyB, '#other');
    let finishSave!: () => void;
    const pendingSave = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const save = vi.fn(() => pendingSave);
    const { rerender } = render(panel({ onMeshcoreSetChannel: save }));
    const section = openChannels();
    fireEvent.click(section.getByRole('button', { name: 'Edit' }));
    fireEvent.change(section.getByRole('combobox', { name: 'Send scope for this channel' }), {
      target: { value: FLOOD_SCOPE_OVERRIDE_UNSCOPED },
    });
    fireEvent.click(section.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledOnce();
    rerender(panel({ identityId: 'radioB', onMeshcoreSetChannel: save }));
    await act(async () => {
      finishSave();
      await pendingSave;
    });
    expect(stored()[keyA]).toBe('#metro');
    expect(stored()[keyB]).toBe('#other');
    fireEvent.click(section.getByRole('button', { name: 'Edit' }));
    expect(section.getByRole('combobox', { name: 'Send scope for this channel' })).toHaveValue(
      '#other',
    );
  });

  it('keeps saved scope on failed delete and clears it after successful delete', async () => {
    saveFloodScopeOverride('meshcore', keyA, '#metro');
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    render(panel({ onMeshcoreDeleteChannel: remove }));
    const section = openChannels();
    fireEvent.click(section.getByRole('button', { name: 'Delete' }));
    await withMockedConsoleWarn(async () => {
      fireEvent.click(section.getByRole('button', { name: 'Confirm' }));
      await waitFor(() => {
        expect(remove).toHaveBeenCalledOnce();
      });
      await waitFor(() => {
        expect(section.getByRole('button', { name: 'Confirm' })).toBeEnabled();
      });
    });
    expect(stored()[keyA]).toBe('#metro');
    fireEvent.click(section.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(stored()[keyA]).toBeUndefined();
    });
  });

  it('exports Default without scope fields and updates QR for external Send choices', () => {
    render(panel());
    const section = openChannels();
    fireEvent.click(section.getByRole('button', { name: 'Show MeshCore channel QR for Metro' }));
    expect(section.getByRole('img').getAttribute('data-qr-value')).not.toContain('scope');
    act(() => {
      saveFloodScopeOverride('meshcore', keyA, FLOOD_SCOPE_OVERRIDE_UNSCOPED);
    });
    expect(
      classifyMeshClientDeepLink(section.getByRole('img').getAttribute('data-qr-value')!),
    ).toMatchObject({ regionScope: '' });
  });

  it('retains an accepted QR draft through radio identity discovery', () => {
    const { rerender } = render(panel({ identityId: null }));
    const section = openChannels();
    fireEvent.click(section.getByRole('button', { name: 'Test QR import' }));
    expect(section.getByRole('button', { name: 'Save' })).toBeDisabled();
    rerender(panel());
    expect(section.getByRole('textbox', { name: 'Name' })).toHaveValue('Imported');
    expect(section.getByRole('combobox', { name: 'Send scope for this channel' })).toHaveValue(
      FLOOD_SCOPE_OVERRIDE_UNSCOPED,
    );
    expect(section.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('keeps the draft and reports partial success if storing scope fails, then retries', async () => {
    saveFloodScopeOverride('meshcore', keyA, '#metro');
    const save = vi.fn().mockResolvedValue(undefined);
    render(panel({ onMeshcoreSetChannel: save }));
    const section = openChannels();
    fireEvent.click(section.getByRole('button', { name: 'Edit' }));
    fireEvent.change(section.getByRole('combobox', { name: 'Send scope for this channel' }), {
      target: { value: FLOOD_SCOPE_OVERRIDE_UNSCOPED },
    });
    const storageWrite = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    try {
      fireEvent.click(section.getByRole('button', { name: 'Save' }));
      await screen.findByText(
        'Channel saved, but its send scope could not be saved in this app. Retry Save.',
      );
      expect(save).toHaveBeenCalledOnce();
      expect(stored()[keyA]).toBe('#metro');
      expect(section.getByRole('combobox', { name: 'Send scope for this channel' })).toHaveValue(
        FLOOD_SCOPE_OVERRIDE_UNSCOPED,
      );
    } finally {
      storageWrite.mockRestore();
    }
    fireEvent.click(section.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(stored()[keyA]).toBe(FLOOD_SCOPE_OVERRIDE_UNSCOPED);
    });
  });
});
