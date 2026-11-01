import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { useCustomMapSourcesStore } from '@/renderer/stores/customMapSourcesStore';
import { useMapLayerStore } from '@/renderer/stores/mapLayerStore';
import type { CustomMapSourceInfo } from '@/shared/offlineMaps/customMapSources';

import { CustomMapSourcesSection } from './CustomMapSourcesSection';

const xyzSource: CustomMapSourceInfo = {
  id: 'xyz-0123456789ab',
  kind: 'xyz',
  name: 'Example topo',
  attribution: 'Example',
  addedAt: 1,
  host: 'tiles.example.org',
};

describe('CustomMapSourcesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCustomMapSourcesStore.setState({ sources: null });
    useMapLayerStore.setState({ basemapId: 'osm' });
    vi.mocked(window.electronAPI.offlineMaps.custom.list).mockResolvedValue([xyzSource]);
    vi.mocked(window.electronAPI.offlineMaps.status).mockResolvedValue({
      activeJobs: [],
      stats: { tileCount: 3, diskBytes: 3 * 1024 * 1024 },
      regions: [],
      sources: {
        osm: { tileCount: 1, diskBytes: 2048 },
        'xyz-0123456789ab': { tileCount: 2, diskBytes: 1024 * 1024 },
      },
    });
  });

  it('lists per-source storage with clear and remove actions', async () => {
    const user = userEvent.setup();
    render(<CustomMapSourcesSection />);
    // Name/size and xyzMeta are separate nodes — assert via the source row, not one combined string.
    const row = (await screen.findByText(/Example topo/)).closest('li');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent(/1\.0 MB/);
    expect(row).toHaveTextContent('tiles.example.org');
    expect(row).toHaveTextContent(/cache capped at 256\.0 MB/);
    expect(screen.getByText(/OpenStreetMap \(light\) · 2\.0 KB/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear cached tiles for Example topo' }));
    expect(window.electronAPI.offlineMaps.clear).toHaveBeenCalledWith('xyz-0123456789ab');
    await user.click(screen.getByRole('button', { name: 'Remove custom map source Example topo' }));
    expect(window.electronAPI.offlineMaps.custom.remove).toHaveBeenCalledWith('xyz-0123456789ab');
  });

  it('blocks adding an XYZ source until URL, attribution and confirmation are valid', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.offlineMaps.custom.addXyz).mockResolvedValue({
      ok: true,
      source: { ...xyzSource, id: 'xyz-ffffffffffff', name: 'New' },
    });
    render(<CustomMapSourcesSection />);
    await user.click(await screen.findByRole('button', { name: 'Add a custom XYZ tile server' }));
    const add = screen.getByRole('button', { name: 'Add custom XYZ source' });
    expect(add).toBeDisabled();

    await user.type(screen.getByLabelText('Name'), 'New');
    await user.type(
      screen.getByLabelText(/Tile URL/),
      'http://insecure.example.org/{z}/{x}/{y}.png',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Only https:// URLs are allowed.');
    await user.clear(screen.getByLabelText(/Tile URL/));
    await user.click(screen.getByLabelText(/Tile URL/));
    await user.paste('https://tiles.example.org/{z}/{x}/{y}.png');
    await user.type(screen.getByLabelText(/Attribution/), '© Example');
    expect(add).toBeDisabled(); // still needs explicit confirmation
    await user.click(
      screen.getByRole('checkbox', { name: 'Confirm permission to use this tile server' }),
    );
    expect(screen.getByText(/allowed to use tiles from tiles\.example\.org/)).toBeInTheDocument();
    expect(add).toBeEnabled();
    await user.click(add);

    expect(window.electronAPI.offlineMaps.custom.addXyz).toHaveBeenCalledWith({
      name: 'New',
      urlTemplate: 'https://tiles.example.org/{z}/{x}/{y}.png',
      attribution: '© Example',
      confirmed: true,
    });
    await waitFor(() => {
      expect(useMapLayerStore.getState().basemapId).toBe('xyz-ffffffffffff');
    });
  });

  it('imports MBTiles only after the user supplies attribution and confirms', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.offlineMaps.custom.pickMbtiles).mockResolvedValue({
      ok: true,
      inspectId: 'insp-1',
      name: 'Trail pack',
      attribution: '',
      format: 'png',
      minZoom: 0,
      maxZoom: 12,
      fileBytes: 5 * 1024 * 1024,
    });
    vi.mocked(window.electronAPI.offlineMaps.custom.importMbtiles).mockResolvedValue({
      ok: true,
      source: {
        id: 'mbtiles-0123456789ab',
        kind: 'mbtiles',
        name: 'Trail pack',
        attribution: 'Me',
        addedAt: 1,
        minZoom: 0,
        maxNativeZoom: 12,
        fileBytes: 5 * 1024 * 1024,
      },
    });
    render(<CustomMapSourcesSection />);
    await user.click(
      await screen.findByRole('button', { name: 'Import an MBTiles package for offline use' }),
    );
    const importBtn = await screen.findByRole('button', { name: 'Import MBTiles package' });
    expect(importBtn).toBeDisabled();
    expect(screen.getByText(/PNG tiles, zoom 0–12, 5\.0 MB/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Attribution/), 'Me');
    await user.click(
      screen.getByRole('checkbox', { name: 'Confirm permission to use this MBTiles package' }),
    );
    await user.click(importBtn);
    expect(window.electronAPI.offlineMaps.custom.importMbtiles).toHaveBeenCalledWith({
      inspectId: 'insp-1',
      name: 'Trail pack',
      attribution: 'Me',
      confirmed: true,
    });
  });

  it('shows a translated message when the main process rejects an import', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.offlineMaps.custom.pickMbtiles).mockResolvedValue({
      ok: false,
      code: 'mbtiles_vector',
    });
    render(<CustomMapSourcesSection />);
    await user.click(
      await screen.findByRole('button', { name: 'Import an MBTiles package for offline use' }),
    );
    expect(await screen.findByText(/Vector MBTiles are not supported/)).toBeInTheDocument();
  });

  it('has no axe violations (list + XYZ form)', async () => {
    const user = userEvent.setup();
    const { container } = render(<CustomMapSourcesSection />);
    await user.click(await screen.findByRole('button', { name: 'Add a custom XYZ tile server' }));
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
