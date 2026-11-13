import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WaypointEditorDialog } from '@/renderer/components/map/WaypointEditorDialog';

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
});
