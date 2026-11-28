import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StatusBar } from '@/renderer/components/shell/StatusBar';
import UpdateStatusIndicator from '@/renderer/components/UpdateStatusIndicator';

// The mobile Vitest config applies the desktop-overrides plugin, so this import is the override,
// as it is for App.tsx in the app.
describe('UpdateStatusIndicator (mobile)', () => {
  it('shows nothing in the status strip, where the desktop shows "Checking..."', () => {
    const indicator = (
      <UpdateStatusIndicator
        updateState={{ phase: 'idle', isPackaged: true }}
        onCheck={vi.fn()}
        onDownload={vi.fn()}
        onInstall={vi.fn()}
        onViewRelease={vi.fn()}
      />
    );
    const { container } = render(
      <StatusBar stats="0 nodes" update={indicator} liveStatus="">
        <span>Disconnected</span>
      </StatusBar>,
    );
    expect(container.textContent).toContain('Disconnected');
    expect(container.textContent).not.toMatch(/checking/i);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
