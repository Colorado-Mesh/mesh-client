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
  localStorage.removeItem('mesh-mobile:phoneLocationId');
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

  it('asks "Still at" with the phone option, and confirms in one tap', () => {
    const eoc = saveNewLocation({ name: 'EOC', lat: 39.7, lon: -104.9, fixed: false });
    render(<SetLocationCard ourPosition={null} trust="needsConfirm" variant="startup" />);
    expect(screen.getByRole('heading', { name: 'Still at EOC?' })).toBeInTheDocument();
    // A phone is not "this computer" (the desktop sentence).
    expect(
      screen.getByText(/Confirm this phone is still at the saved position/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Use this phone's location" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Yes, still at EOC/ }));
    expect(useLocationPromptStore.getState().confirmedLocationId).toBe(eoc.id);
  });

  it('"New location" opens the phone choices, and Cancel returns to the question', () => {
    saveNewLocation({ name: 'EOC', lat: 39.7, lon: -104.9, fixed: false });
    render(<SetLocationCard ourPosition={null} trust="needsConfirm" variant="startup" />);
    fireEvent.click(screen.getByRole('button', { name: 'New location' }));
    expect(screen.getByRole('button', { name: 'Enter manually' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Still at EOC?' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Still at EOC?' })).toBeInTheDocument();
  });

  it('updates the one "This phone" entry on later uses instead of adding another', async () => {
    const fix = vi.fn().mockResolvedValue({ lat: 39.75, lon: -105.0, source: 'native' });
    window.electronAPI.getGpsFix = fix;
    const first = render(<SetLocationCard ourPosition={null} trust="unknown" variant="startup" />);
    fireEvent.click(screen.getByRole('button', { name: "Use this phone's location" }));
    await vi.waitFor(() => {
      expect(readSavedLocations().locations).toHaveLength(1);
    });
    first.unmount();
    // Next launch, somewhere else: "Still at This phone?" -> use the phone again.
    fix.mockResolvedValue({ lat: 40.01, lon: -105.27, source: 'native' });
    render(<SetLocationCard ourPosition={null} trust="needsConfirm" variant="startup" />);
    fireEvent.click(screen.getByRole('button', { name: "Use this phone's location" }));
    await vi.waitFor(() => {
      expect(getActiveSavedLocation()).toMatchObject({ lat: 40.01, lon: -105.27 });
    });
    expect(readSavedLocations().locations).toHaveLength(1);
  });

  it('adopts an earlier "This phone" entry that has no remembered id', async () => {
    saveNewLocation({ name: 'This phone', lat: 39.75, lon: -105.0, fixed: false });
    saveNewLocation({ name: 'Home', lat: 40, lon: -105, fixed: true });
    window.electronAPI.getGpsFix = vi
      .fn()
      .mockResolvedValue({ lat: 40.01, lon: -105.27, source: 'native' });
    render(<SetLocationCard ourPosition={null} trust="unknown" variant="startup" />);
    fireEvent.click(screen.getByRole('button', { name: "Use this phone's location" }));
    await vi.waitFor(() => {
      expect(getActiveSavedLocation()).toMatchObject({ name: 'This phone', lat: 40.01 });
    });
    expect(
      readSavedLocations()
        .locations.map((l) => l.name)
        .sort(),
    ).toEqual(['Home', 'This phone']);
  });

  it('has no axe violations while confirming', async () => {
    saveNewLocation({ name: 'EOC', lat: 39.7, lon: -104.9, fixed: false });
    const { container } = render(
      <SetLocationCard
        ourPosition={null}
        trust="needsConfirm"
        variant="startup"
        onDismiss={vi.fn()}
      />,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
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
