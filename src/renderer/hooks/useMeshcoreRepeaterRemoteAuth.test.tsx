import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import { meshcoreRepeaterCredentialSettingForNode } from '@/renderer/lib/meshcoreRepeaterCredentialStorage';
import { clearAllMeshcoreRepeaterEphemeralPasswords } from '@/renderer/lib/meshcoreRepeaterSession';

import { useMeshcoreRepeaterRemoteAuth } from './useMeshcoreRepeaterRemoteAuth';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function RepeaterAuthProbe({ nodeId, repeaterName }: { nodeId: number; repeaterName: string }) {
  const { ensureRepeaterAuth, RemoteAuthModal } = useMeshcoreRepeaterRemoteAuth();
  const [result, setResult] = useState<{ ok: boolean; saved?: boolean } | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void ensureRepeaterAuth(nodeId, repeaterName).then(setResult);
        }}
      >
        request-auth
      </button>
      {result != null && <output data-testid="auth-result">{JSON.stringify(result)}</output>}
      {RemoteAuthModal}
    </>
  );
}

describe('useMeshcoreRepeaterRemoteAuth', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllMeshcoreRepeaterEphemeralPasswords();
    vi.mocked(window.electronAPI.appSettings.set).mockClear();
  });

  it('resolves immediately when a saved credential exists', async () => {
    mergeAppSetting(
      meshcoreRepeaterCredentialSettingForNode(0xabc),
      JSON.stringify({ password: 'secret' }),
      'useMeshcoreRepeaterRemoteAuth.test',
    );

    render(<RepeaterAuthProbe nodeId={0xabc} repeaterName="Test Repeater" />);
    fireEvent.click(screen.getByText('request-auth'));

    await waitFor(() => {
      expect(screen.getByTestId('auth-result')).toHaveTextContent(JSON.stringify({ ok: true }));
    });
    expect(screen.queryByText('repeatersPanel.remoteAuthTitle')).not.toBeInTheDocument();
  });

  it('opens modal when no saved credential exists', async () => {
    render(<RepeaterAuthProbe nodeId={0xdef} repeaterName="Fresh Repeater" />);
    fireEvent.click(screen.getByText('request-auth'));

    expect(await screen.findByText('repeatersPanel.remoteAuthTitle')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-result')).not.toBeInTheDocument();
  });
});
