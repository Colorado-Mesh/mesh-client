import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { FirmwareDownloadLinks } from './FirmwareDownloadLinks';

describe('FirmwareDownloadLinks', () => {
  it('has no axe violations', async () => {
    hydrateAxeThemeColors(document.documentElement);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => ({
          assets: [
            {
              name: 'rnode_firmware_heltec32v3.zip',
              browser_download_url:
                'https://github.com/markqvist/RNode_Firmware/releases/download/v1.99/rnode_firmware_heltec32v3.zip',
            },
          ],
        }),
      }),
    );
    const { container } = render(
      <FirmwareDownloadLinks recommendedFilename="rnode_firmware_heltec32v3.zip" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('resolves latest release download URL from GitHub API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => ({
          assets: [
            {
              name: 'rnode_firmware_heltec32v3.zip',
              browser_download_url:
                'https://github.com/markqvist/RNode_Firmware/releases/download/v1.99/rnode_firmware_heltec32v3.zip',
            },
          ],
        }),
      }),
    );

    render(<FirmwareDownloadLinks recommendedFilename="rnode_firmware_heltec32v3.zip" />);

    const link = await screen.findByRole('link', {
      name: /rnode_firmware_heltec32v3\.zip \(latest release\)/i,
    });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/markqvist/RNode_Firmware/releases/download/v1.99/rnode_firmware_heltec32v3.zip',
    );
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/markqvist/RNode_Firmware/releases/latest',
        expect.objectContaining({ headers: { Accept: 'application/vnd.github+json' } }),
      );
    });
  });
});
