import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RrcPanel from './RrcPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('RrcPanel', () => {
  beforeEach(() => {
    window.electronAPI.reticulum.getStatus = vi
      .fn()
      .mockResolvedValue({ running: true, port: 1, pid: 1 });
    window.electronAPI.reticulum.onStatus = vi.fn().mockReturnValue(() => {});
    window.electronAPI.reticulum.rrc.listHubs = vi.fn().mockResolvedValue({ hubs: [] });
  });

  it('renders recommended hub section and manual connect', async () => {
    render(<RrcPanel isActive />);
    expect(await screen.findByText('rrc.hubs.recommended')).toBeInTheDocument();
    expect(screen.getByLabelText('rrc.manualHashPlaceholder')).toBeInTheDocument();
    expect(screen.getByLabelText('rrc.connectManual')).toBeInTheDocument();
  });
});
