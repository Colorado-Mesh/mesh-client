import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MeshcoreFloodScopeSection } from './MeshcoreFloodScopeSection';

describe('MeshcoreFloodScopeSection', () => {
  it('applies preset flood scope in standalone mode', async () => {
    const onApplyFloodScope = vi.fn().mockResolvedValue(undefined);
    render(
      <MeshcoreFloodScopeSection
        disabled={false}
        isConnected
        savedHashtag=""
        onApplyFloodScope={onApplyFloodScope}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /Preset hashtag/i }));
    fireEvent.click(screen.getByRole('button', { name: /Apply flood scope/i }));

    await waitFor(() => {
      expect(onApplyFloodScope).toHaveBeenCalledWith('#colorado');
    });
  });

  it('shows failure status without unhandled rejection when apply fails', async () => {
    const onApplyFloodScope = vi.fn().mockRejectedValue(new Error('radio offline'));
    render(
      <MeshcoreFloodScopeSection
        disabled={false}
        isConnected
        savedHashtag=""
        onApplyFloodScope={onApplyFloodScope}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Apply flood scope/i }));

    await waitFor(() => {
      expect(screen.getByText(/radio offline/)).toBeInTheDocument();
    });
  });

  it('embedded mode omits standalone apply button', () => {
    render(
      <MeshcoreFloodScopeSection
        embedded
        disabled={false}
        isConnected
        savedHashtag="#mesh"
        onApplyFloodScope={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Apply flood scope/i })).not.toBeInTheDocument();
  });
});
