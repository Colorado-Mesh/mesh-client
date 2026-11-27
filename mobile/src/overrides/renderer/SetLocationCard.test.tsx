import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { GPS_SETTINGS_STORAGE_KEY } from '@/renderer/lib/gpsSource';
import i18n from '@/renderer/lib/i18n';
import {
  getActiveSavedLocation,
  readSavedLocations,
  resetSavedLocationsCacheForTests,
  SAVED_LOCATIONS_STORAGE_KEY,
  saveNewLocation,
} from '@/renderer/lib/savedLocations';
import { useLocationPromptStore } from '@/renderer/stores/locationPromptStore';

import { installMobileI18n } from '../../i18nMobile';
import SetLocationCard from './SetLocationCard';

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

beforeAll(() => {
  installMobileI18n(i18n);
});

describe('SetLocationCard (mobile)', () => {
  beforeEach(resetState);
  afterEach(resetState);

  it('offers the phone location first and keeps manual entry reversible', () => {
    render(<SetLocationCard ourPosition={null} trust="unknown" variant="startup" />);
    expect(screen.getByText(/Use this phone's location or enter one/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Coordinates')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Enter manually' }));
    expect(screen.getByLabelText('Coordinates')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Coordinates')).toBeNull();
    expect(screen.getByRole('button', { name: "Use this phone's location" })).toBeInTheDocument();
  });

  it('saves and confirms "This phone" from the native GPS fix', async () => {
    window.electronAPI.getGpsFix = vi.fn().mockResolvedValue({
      lat: 39.75,
      lon: -105.0,
      source: 'native',
    });
    const onLocationChanged = vi.fn();
    render(
      <SetLocationCard
        ourPosition={null}
        trust="unknown"
        variant="startup"
        onLocationChanged={onLocationChanged}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: "Use this phone's location" }));
    await vi.waitFor(() => {
      expect(onLocationChanged).toHaveBeenCalled();
    });
    const active = getActiveSavedLocation();
    expect(active).toMatchObject({ name: 'This phone', lat: 39.75, lon: -105.0 });
    expect(useLocationPromptStore.getState().confirmedLocationId).toBe(active?.id);
  });

  it('reports a failed phone fix (IP fallback) without saving', async () => {
    window.electronAPI.getGpsFix = vi.fn().mockResolvedValue({ lat: 1, lon: 2, source: 'ip' });
    render(<SetLocationCard ourPosition={null} trust="unknown" variant="startup" />);
    fireEvent.click(screen.getByRole('button', { name: "Use this phone's location" }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Couldn't get this phone's location/,
    );
    expect(readSavedLocations().locations).toHaveLength(0);
  });

  it('switches to a saved location in one tap', () => {
    const home = saveNewLocation({ name: 'Home', lat: 40, lon: -105, fixed: true });
    saveNewLocation({ name: 'EOC', lat: 39.7, lon: -104.9, fixed: true });
    const onLocationChanged = vi.fn();
    render(
      <SetLocationCard
        ourPosition={null}
        trust="unknown"
        variant="diagnostics"
        onLocationChanged={onLocationChanged}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Home/ }));
    expect(getActiveSavedLocation()?.id).toBe(home.id);
    expect(onLocationChanged).toHaveBeenCalledTimes(1);
  });

  it('defers to the desktop card when confirming a saved location', () => {
    saveNewLocation({ name: 'EOC', lat: 39.7, lon: -104.9, fixed: false });
    render(<SetLocationCard ourPosition={null} trust="needsConfirm" variant="startup" />);
    expect(screen.queryByRole('button', { name: "Use this phone's location" })).toBeNull();
  });

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

  it('has no axe violations', async () => {
    const { container } = render(
      <SetLocationCard ourPosition={null} trust="unknown" variant="startup" onDismiss={vi.fn()} />,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
