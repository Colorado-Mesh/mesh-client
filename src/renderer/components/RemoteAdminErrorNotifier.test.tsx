import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import RemoteAdminErrorNotifier from './RemoteAdminErrorNotifier';
import { ToastProvider } from './Toast';

describe('RemoteAdminErrorNotifier', () => {
  it('shows a toast when remote admin enters error state', async () => {
    render(
      <ToastProvider>
        <RemoteAdminErrorNotifier
          status="error"
          errorKey="remoteAdmin.errors.publicKeyUnauthorized"
        />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Unauthorized/i);
    });
  });

  it('shows toast again after loading then the same error', async () => {
    const { rerender } = render(
      <ToastProvider>
        <RemoteAdminErrorNotifier
          status="error"
          errorKey="remoteAdmin.errors.publicKeyUnauthorized"
        />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Unauthorized/i);
    });

    rerender(
      <ToastProvider>
        <RemoteAdminErrorNotifier status="loading" errorKey={undefined} />
      </ToastProvider>,
    );

    rerender(
      <ToastProvider>
        <RemoteAdminErrorNotifier
          status="error"
          errorKey="remoteAdmin.errors.publicKeyUnauthorized"
        />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Unauthorized/i);
    });
  });
});
