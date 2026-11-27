import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { GPS_SETTINGS_STORAGE_KEY, readStoredStaticGps } from '../lib/gpsSource';
import {
  getActiveSavedLocation,
  readSavedLocations,
  resetSavedLocationsCacheForTests,
  SAVED_LOCATIONS_STORAGE_KEY,
  saveNewLocation,
} from '../lib/savedLocations';
import { useLocationPromptStore } from '../stores/locationPromptStore';
import SetLocationCard from './SetLocationCard';
import StartupLocationPrompt from './StartupLocationPrompt';

function resetState() {
  localStorage.removeItem(GPS_SETTINGS_STORAGE_KEY);
  localStorage.removeItem(SAVED_LOCATIONS_STORAGE_KEY);
  resetSavedLocationsCacheForTests();
  useLocationPromptStore.setState({
    confirmedLocationId: null,
    dismissedThisSession: false,
    positionResolved: false,
  });
}

describe('SetLocationCard', () => {
  beforeEach(resetState);
  afterEach(resetState);

  it('renders nothing when the position is trusted', () => {
    const { container } = render(
      <SetLocationCard
        ourPosition={{ lat: 39.7, lon: -104.9, source: 'device' }}
        trust="trusted"
        variant="diagnostics"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('unknown: saving pasted coords creates, activates, and confirms a named location', () => {
    const onLocationChanged = vi.fn();
    render(
      <SetLocationCard
        ourPosition={null}
        trust="unknown"
        variant="diagnostics"
        onLocationChanged={onLocationChanged}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Set your location' })).toBeInTheDocument();
    expect(screen.getByText(/Distance checks .* are paused/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'EOC' } });
    fireEvent.change(screen.getByLabelText('Coordinates'), {
      target: { value: '40.01500, -105.27050' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }));

    const active = getActiveSavedLocation();
    expect(active).toMatchObject({ name: 'EOC', lat: 40.015, lon: -105.2705 });
    expect(readStoredStaticGps()).toEqual({ lat: 40.015, lon: -105.2705 });
    expect(useLocationPromptStore.getState().confirmedLocationId).toBe(active?.id);
    expect(onLocationChanged).toHaveBeenCalledTimes(1);
  });

  it('shows a validation error for unparseable coordinates', () => {
    render(<SetLocationCard ourPosition={null} trust="unknown" variant="startup" />);
    fireEvent.change(screen.getByLabelText('Coordinates'), { target: { value: '91, 0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }));
    expect(screen.getByText(/Enter a latitude between -90 and 90/)).toBeInTheDocument();
    expect(readSavedLocations().locations).toHaveLength(0);
  });

  it('approximate: prefills coordinates from the IP estimate', () => {
    render(
      <SetLocationCard
        ourPosition={{ lat: 39.73915, lon: -104.9847, source: 'ip' }}
        trust="approximate"
        variant="diagnostics"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start from approximate position' }));
    expect(screen.getByLabelText('Coordinates')).toHaveValue('39.73915, -104.98470');
  });

  it('needsConfirm: "Yes" confirms the active location for this session', () => {
    const home = saveNewLocation({ name: 'Home', lat: 39.7392, lon: -104.9903 });
    const onLocationChanged = vi.fn();
    render(
      <SetLocationCard
        ourPosition={{ lat: 39.7392, lon: -104.9903, source: 'static' }}
        trust="needsConfirm"
        variant="startup"
        onLocationChanged={onLocationChanged}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Still at Home?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, still at Home' }));
    expect(useLocationPromptStore.getState().confirmedLocationId).toBe(home.id);
    expect(onLocationChanged).toHaveBeenCalledTimes(1);
  });

  it('needsConfirm: one click switches to another saved location (home -> EOC)', () => {
    const home = saveNewLocation({ name: 'Home', lat: 39.7392, lon: -104.9903 });
    const eoc = saveNewLocation({ name: 'EOC', lat: 40.015, lon: -105.2705 }, { activate: false });
    expect(getActiveSavedLocation()?.id).toBe(home.id);
    render(
      <SetLocationCard
        ourPosition={{ lat: 39.7392, lon: -104.9903, source: 'static' }}
        trust="needsConfirm"
        variant="startup"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Switch to EOC' }));
    expect(getActiveSavedLocation()?.id).toBe(eoc.id);
    expect(readStoredStaticGps()).toEqual({ lat: 40.015, lon: -105.2705 });
    expect(useLocationPromptStore.getState().confirmedLocationId).toBe(eoc.id);
  });

  it('needsConfirm: "New location" opens the form and cancel returns to confirm', () => {
    saveNewLocation({ name: 'Home', lat: 39.7392, lon: -104.9903 });
    render(
      <SetLocationCard
        ourPosition={{ lat: 39.7392, lon: -104.9903, source: 'static' }}
        trust="needsConfirm"
        variant="startup"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New location' }));
    expect(screen.getByLabelText('Coordinates')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Yes, still at Home' })).toBeInTheDocument();
  });

  it('has no axe violations in the confirm and form states', async () => {
    saveNewLocation({ name: 'Home', lat: 39.7392, lon: -104.9903 });
    saveNewLocation({ name: 'EOC', lat: 40.015, lon: -105.2705 }, { activate: false });
    const confirm = render(
      <SetLocationCard
        ourPosition={{ lat: 39.7392, lon: -104.9903, source: 'static' }}
        trust="needsConfirm"
        variant="startup"
        onDismiss={vi.fn()}
      />,
    );
    hydrateAxeThemeColors(confirm.container);
    expect(await axe(confirm.container)).toHaveNoViolations();
    confirm.unmount();

    const form = render(
      <SetLocationCard
        ourPosition={{ lat: 39.7, lon: -104.9, source: 'ip' }}
        trust="approximate"
        variant="diagnostics"
      />,
    );
    hydrateAxeThemeColors(form.container);
    expect(await axe(form.container)).toHaveNoViolations();
  });
});

describe('StartupLocationPrompt', () => {
  beforeEach(resetState);
  afterEach(resetState);

  it('waits for the first position resolve before prompting', () => {
    const { rerender } = render(<StartupLocationPrompt ourPosition={null} enabled />);
    expect(screen.queryByRole('heading', { name: 'Set your location' })).toBeNull();
    useLocationPromptStore.getState().markPositionResolved();
    rerender(<StartupLocationPrompt ourPosition={null} enabled />);
    expect(screen.getByRole('heading', { name: 'Set your location' })).toBeInTheDocument();
  });

  it('stays hidden when disabled, dismissed, or the radio reports GPS', () => {
    useLocationPromptStore.getState().markPositionResolved();
    const { rerender } = render(<StartupLocationPrompt ourPosition={null} enabled={false} />);
    expect(screen.queryByRole('heading')).toBeNull();

    rerender(
      <StartupLocationPrompt ourPosition={{ lat: 39.7, lon: -104.9, source: 'device' }} enabled />,
    );
    expect(screen.queryByRole('heading')).toBeNull();

    rerender(<StartupLocationPrompt ourPosition={null} enabled />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss location prompt for this session' }),
    );
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('skips confirmation for a location marked as not moving', () => {
    useLocationPromptStore.getState().markPositionResolved();
    saveNewLocation({ name: 'Home', lat: 39.7392, lon: -104.9903, fixed: true });
    render(
      <StartupLocationPrompt
        ourPosition={{ lat: 39.7392, lon: -104.9903, source: 'static' }}
        enabled
      />,
    );
    expect(screen.queryByRole('heading')).toBeNull();
  });
});
