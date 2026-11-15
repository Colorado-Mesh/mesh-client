import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  defaultBoundingBoxAround,
  expireHoursFromUnix,
  isValidWaypointBoundingBox,
  WaypointEditorDialog,
} from '@/renderer/components/map/WaypointEditorDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('WaypointEditorDialog', () => {
  it('submits a create payload with capped name', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <WaypointEditorDialog
        open
        mode="create"
        myNodeNum={9}
        initial={{ latitude: 1, longitude: 2 }}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText('mapPanel.waypointNameLabel'), {
      target: { value: 'A'.repeat(40) },
    });
    fireEvent.click(screen.getByLabelText('mapPanel.waypointSave'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0][0].name).toHaveLength(29);
    expect(onClose).toHaveBeenCalled();
  });

  it('blocks edit when locked to another node', () => {
    render(
      <WaypointEditorDialog
        open
        mode="edit"
        myNodeNum={9}
        initial={{ id: 1, latitude: 1, longitude: 2, name: 'X', lockedTo: 99 }}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText('mapPanel.waypointLockedByOther')).toBeTruthy();
    expect(screen.queryByLabelText('mapPanel.waypointSave')).toBeNull();
  });

  it('preserves existing expire when editing without touching the expiry field', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expire = nowSec + 5 * 3600;
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <WaypointEditorDialog
        open
        mode="edit"
        myNodeNum={9}
        initial={{ id: 1, latitude: 1, longitude: 2, name: 'Camp', expire, lockedTo: 9 }}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const expireInput = screen.getByLabelText('mapPanel.waypointExpireLabel');
    expect(expireInput).toBeInstanceOf(HTMLInputElement);
    expect(Number((expireInput as HTMLInputElement).value)).toBe(
      expireHoursFromUnix(expire, nowSec),
    );
    fireEvent.change(screen.getByLabelText('mapPanel.waypointNameLabel'), {
      target: { value: 'Camp 2' },
    });
    fireEvent.click(screen.getByLabelText('mapPanel.waypointSave'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0][0].expire).toBe(expire);
  });

  it('submits geofence radius and notify flags', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <WaypointEditorDialog
        open
        mode="create"
        myNodeNum={9}
        initial={{ latitude: 40.1, longitude: -105.2 }}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText('mapPanel.waypointNameLabel'), {
      target: { value: 'Fence' },
    });
    fireEvent.change(screen.getByLabelText('mapPanel.waypointGeofenceRadiusLabel'), {
      target: { value: '250' },
    });
    fireEvent.click(screen.getByLabelText('mapPanel.waypointNotifyOnEnter'));
    fireEvent.click(screen.getByLabelText('mapPanel.waypointSave'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Fence',
      geofenceRadius: 250,
      notifyOnEnter: true,
      notifyOnExit: false,
      notifyFavoritesOnly: false,
    });
  });

  it('rejects invalid bounding boxes and accepts boundary coordinates', async () => {
    expect(isValidWaypointBoundingBox({ west: 10, south: 20, east: 10, north: 21 })).toBe(false);
    expect(isValidWaypointBoundingBox({ west: -181, south: 0, east: -170, north: 1 })).toBe(false);
    expect(isValidWaypointBoundingBox({ west: -180, south: -90, east: 180, north: 90 })).toBe(true);

    const nearPole = defaultBoundingBoxAround(0, 89.995);
    expect(nearPole.north).toBeLessThanOrEqual(90);
    expect(nearPole.south).toBeLessThan(nearPole.north);
    expect(isValidWaypointBoundingBox(nearPole)).toBe(true);

    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <WaypointEditorDialog
        open
        mode="create"
        myNodeNum={9}
        initial={{
          latitude: 40,
          longitude: -105,
          boundingBox: { west: 10, south: 20, east: 5, north: 21 },
        }}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText('mapPanel.waypointNameLabel'), {
      target: { value: 'Bad box' },
    });
    fireEvent.click(screen.getByLabelText('mapPanel.waypointSave'));
    await waitFor(() => {
      expect(screen.getByText('mapPanel.waypointBoundingBoxInvalid')).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
