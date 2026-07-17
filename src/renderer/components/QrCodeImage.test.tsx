import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const toDataURL = vi.fn();

vi.mock('qrcode', () => ({
  default: {
    toDataURL: (...args: unknown[]) => toDataURL(...args),
  },
}));

import QrCodeImage from './QrCodeImage';

describe('QrCodeImage', () => {
  beforeEach(() => {
    toDataURL.mockReset();
  });

  it('renders an image when encode succeeds', async () => {
    toDataURL.mockResolvedValue('data:image/png;base64,abc');
    render(<QrCodeImage value="lxm://contact/aa" />);
    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'qrIngest.qrImageAlt' })).toBeTruthy();
    });
  });

  it('surfaces encode failures', async () => {
    toDataURL.mockRejectedValue(new Error('boom'));
    render(<QrCodeImage value="lxm://contact/aa" />);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('qrIngest.encodeFailed');
    });
  });
});
