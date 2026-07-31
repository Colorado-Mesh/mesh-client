import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

import { ToastProvider } from '../components/Toast';

/** Render UI wrapped in ToastProvider (panel tests that fire toasts). */
export function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}
