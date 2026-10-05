import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { installDevElectronApiStubIfNeeded } from '@/renderer/lib/devElectronApiStub';
import { subscribeOpenSettingRequests } from '@/renderer/lib/openSettingRequest';

import { ChatPayloadText } from './ChatPayloadText';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockFetch.mockClear();
  Object.defineProperty(window, 'electronAPI', {
    value: { chat: { linkPreview: { fetch: mockFetch } } },
    writable: true,
    configurable: true,
  });
});

describe('ChatPayloadText', () => {
  it('renders plain text', () => {
    render(<ChatPayloadText text="hello world" query="" />);
    expect(screen.getByText(/hello world/)).toBeInTheDocument();
  });

  it('renders MeshCore Open g:GIFID wire as inline GIF', () => {
    render(<ChatPayloadText text="g:a5viI92PAF89q" query="" />);
    const img = screen.getByRole('img', { name: 'GIF' });
    expect(img).toHaveAttribute('src', 'https://media.giphy.com/media/a5viI92PAF89q/giphy.gif');
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://giphy.com/gifs/a5viI92PAF89q',
    );
  });

  it('renders shared location OSM messages as a LocationCard', () => {
    render(
      <ChatPayloadText
        text={
          '📍 Shared location: 39.7392, -104.9903\nhttps://www.openstreetmap.org/?mlat=39.7392&mlon=-104.9903'
        }
        query=""
        loadLinkPreviews={false}
      />,
    );
    expect(screen.getByText(/39\.7392, -104\.9903/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/?mlat=39.7392&mlon=-104.9903',
    );
    const tile = screen.getByRole('img', { name: 'Shared location map tile' });
    expect(tile.getAttribute('src')).toContain('mesh-tiles://osm/');
  });

  it('leaves the map tile out of a LocationCard on the plain-browser dev bridge', () => {
    // @ts-expect-error test setup: no preload, as in a plain browser tab
    delete window.electronAPI;
    vi.stubEnv('DEV', true);
    try {
      expect(installDevElectronApiStubIfNeeded()).toBe(true);
      render(
        <ChatPayloadText
          text={
            '📍 Shared location: 39.7392, -104.9903' +
            String.fromCharCode(10) +
            'https://www.openstreetmap.org/?mlat=39.7392&mlon=-104.9903'
          }
          query=""
          loadLinkPreviews={false}
        />,
      );
      expect(screen.queryByRole('img', { name: 'Shared location map tile' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Open in Maps' })).toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('LocationCard has no axe violations for cyan card contrast', async () => {
    const { container } = render(
      <ChatPayloadText
        text={
          '📍 Shared location: 39.7392, -104.9903\nhttps://www.openstreetmap.org/?mlat=39.7392&mlon=-104.9903'
        }
        query=""
        loadLinkPreviews={false}
      />,
    );
    hydrateAxeThemeColors(document.documentElement);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders URLs as clickable links', () => {
    mockFetch.mockResolvedValue(null);
    render(<ChatPayloadText text="see https://example.com out" query="" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows preview card when fetch returns metadata', async () => {
    mockFetch.mockResolvedValue({
      title: 'Example Site',
      description: 'A great example',
      image: 'https://example.com/img.png',
    });
    render(<ChatPayloadText text="see https://example.com" query="" />);
    await waitFor(() => {
      expect(screen.getByText('Example Site')).toBeInTheDocument();
      expect(screen.getByText('A great example')).toBeInTheDocument();
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });
  });

  it('renders direct image URLs as a large inline embed', async () => {
    mockFetch.mockResolvedValue({
      title: 'photo.jpg',
      image: 'data:image/jpeg;base64,abc',
      kind: 'image',
    });
    render(<ChatPayloadText text="https://cdn.example.com/photo.jpg" query="" />);
    await waitFor(() => {
      const img = screen.getByRole('img', { name: 'Image: photo.jpg' });
      expect(img).toHaveAttribute('src', 'data:image/jpeg;base64,abc');
      expect(img.className).toContain('max-h-64');
    });
    expect(screen.getByRole('link', { name: 'Image: photo.jpg' })).toHaveAttribute(
      'href',
      'https://cdn.example.com/photo.jpg',
    );
    expect(screen.queryByText('cdn.example.com')).not.toBeInTheDocument();
  });

  it('keeps YouTube-style page previews as the compact card', async () => {
    mockFetch.mockResolvedValue({
      title: 'Never Gonna Give You Up',
      description: 'Rick Astley',
      image: 'data:image/jpeg;base64,thumb',
    });
    const { container } = render(
      <ChatPayloadText text="https://www.youtube.com/watch?v=dQw4w9WgXcQ" query="" />,
    );
    await waitFor(() => {
      expect(screen.getByText('Never Gonna Give You Up')).toBeInTheDocument();
      expect(screen.getByText('Rick Astley')).toBeInTheDocument();
      expect(screen.getByText('www.youtube.com')).toBeInTheDocument();
    });
    const thumb = container.querySelector('img');
    expect(thumb).toHaveAttribute('src', 'data:image/jpeg;base64,thumb');
    expect(thumb?.className).toContain('h-16');
  });

  it('hides preview card when fetch returns null', async () => {
    mockFetch.mockResolvedValue(null);
    render(<ChatPayloadText text="see https://example.com" query="" />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('https://example.com');
    });
    expect(screen.queryByText('example.com')).not.toBeInTheDocument();
  });

  it('shows no image element when preview has no image', async () => {
    mockFetch.mockResolvedValue({ title: 'No Image', description: 'text only' });
    const { container } = render(<ChatPayloadText text="https://example.com" query="" />);
    await waitFor(() => {
      expect(screen.getByText('No Image')).toBeInTheDocument();
    });
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('calls fetch for each unique URL in a message', async () => {
    mockFetch.mockResolvedValue(null);
    render(<ChatPayloadText text="go to https://example.com and https://other.org" query="" />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
    expect(mockFetch).toHaveBeenCalledWith('https://example.com');
    expect(mockFetch).toHaveBeenCalledWith('https://other.org');
  });

  it('calls onContentResize when link preview mounts', async () => {
    const onContentResize = vi.fn();
    mockFetch.mockResolvedValue({ title: 'Example Site', description: 'desc' });
    render(
      <ChatPayloadText text="see https://example.com" query="" onContentResize={onContentResize} />,
    );
    await waitFor(() => {
      expect(screen.getByText('Example Site')).toBeInTheDocument();
    });
    expect(onContentResize).toHaveBeenCalled();
  });

  it('renders kind:image embeds without a path extension', async () => {
    mockFetch.mockResolvedValue({
      title: 'abc123',
      image: 'data:image/jpeg;base64,abc',
      kind: 'image',
    });
    render(<ChatPayloadText text="https://cdn.example.com/media/abc123" query="" />);
    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Image: abc123' })).toBeInTheDocument();
    });
    expect(screen.queryByText('cdn.example.com')).not.toBeInTheDocument();
  });

  describe('Mesh-Mapper drone reports', () => {
    const DRONE =
      'Drone: 60:60:1f:f6:d8:bc RSSI:-85 https://maps.google.com/?q=40.453457,-105.084724\r\n' +
      'Pilot: https://maps.google.com/?q=40.453606,-105.086326\r\n';

    it('renders a drone card with OSM links and no link-preview fetch', () => {
      render(<ChatPayloadText text={DRONE} query="" />);
      expect(screen.getByTestId('drone-report-card')).toBeInTheDocument();
      expect(screen.getByText('MAC 60:60:1F:F6:D8:BC')).toBeInTheDocument();
      expect(screen.getByText('RSSI -85 dBm')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open drone location' })).toHaveAttribute(
        'href',
        'https://www.openstreetmap.org/?mlat=40.453457&mlon=-105.084724',
      );
      expect(screen.getByRole('link', { name: 'Open pilot location' })).toBeInTheDocument();
      expect(screen.getByText(/^Pilot .* from drone$/)).toBeInTheDocument();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('has no axe violations', async () => {
      const { container } = render(<ChatPayloadText text={DRONE} query="" />);
      hydrateAxeThemeColors(document.documentElement);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe('ping-bot signal reports', () => {
    it('adds a chip to a MeshMonitor auto-ack and keeps the text', () => {
      render(<ChatPayloadText text="🤖 Copy, 4 hops at 12:51" query="" />);
      expect(screen.getByText('🤖 Copy, 4 hops at 12:51')).toBeInTheDocument();
      const chip = screen.getByRole('group', { name: 'Signal report' });
      expect(chip).toHaveTextContent('4 hops');
    });

    it('shows SNR, RSSI and path tooltip for meshcore-bot acks', () => {
      render(
        <ChatPayloadText
          text="ack @[bob] | 01,5f (2 hops) | SNR: 15 dB | RSSI: -120 dBm | Received at: 21:25:45"
          query=""
        />,
      );
      const chip = screen.getByRole('group', { name: 'Signal report' });
      expect(chip).toHaveTextContent('2 hops');
      expect(chip).toHaveTextContent('SNR 15 dB');
      expect(chip).toHaveTextContent('RSSI -120 dBm');
      expect(chip).toHaveAttribute('title', 'Path: 01,5f');
      expect(screen.getByLabelText('Mention bob')).toBeInTheDocument();
    });

    it('leaves ordinary hop chat alone', () => {
      render(<ChatPayloadText text="3 hops to Firestone" query="" />);
      expect(screen.queryByTestId('signal-report-chip')).toBeNull();
    });

    it('has no axe violations', async () => {
      const { container } = render(
        <ChatPayloadText
          text="Sig @[alice]: heard you at SNR -7.5 | last RSSI -92 dBm, noise -105 dBm"
          query=""
        />,
      );
      hydrateAxeThemeColors(document.documentElement);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe('rncp control messages', () => {
    const REQUEST =
      'Please enable file receiving (rncp) if you use mesh-client: Remote → Settings → Inbound file offers.\n\nmesh-client:request-rncp-receive:v1';
    const HASH = '613023503ca443dfa4099c09dc6f973d';
    const SHARE = `File receiving is enabled. Here is my rncp receive destination.\n${HASH}\n\nmesh-client:rncp-receive-dest:v1:${HASH}`;

    it('hides the request sentinel and shows a chip that opens Remote settings', () => {
      const listener = vi.fn();
      const unsubscribe = subscribeOpenSettingRequests(listener);
      render(
        <ChatPayloadText text={REQUEST} query="" loadLinkPreviews={false} rncpControlEnabled />,
      );
      expect(screen.getByText('File-receive request')).toBeInTheDocument();
      expect(screen.getByText(/Please enable file receiving/)).toBeInTheDocument();
      expect(screen.queryByText(/mesh-client:request-rncp-receive/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Open Remote inbound file settings' }));
      expect(listener).toHaveBeenCalledWith({ slot: 'Remote', id: 'remote.inbound.mode' });
      unsubscribe();
    });

    it('keeps the plain hash line on a destination share', () => {
      render(<ChatPayloadText text={SHARE} query="" loadLinkPreviews={false} rncpControlEnabled />);
      expect(screen.getByText('Shared file-receive destination')).toBeInTheDocument();
      expect(screen.getByText(new RegExp(HASH))).toBeInTheDocument();
      expect(screen.queryByText(/mesh-client:rncp-receive-dest/)).toBeNull();
    });

    it('shows the message unchanged without a chip when rncp is unsupported', () => {
      render(<ChatPayloadText text={REQUEST} query="" loadLinkPreviews={false} />);
      expect(screen.queryByText('File-receive request')).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Open Remote inbound file settings' }),
      ).toBeNull();
      expect(screen.getByText(/mesh-client:request-rncp-receive:v1/)).toBeInTheDocument();
    });

    it('has no axe violations', async () => {
      const { container } = render(
        <ChatPayloadText text={REQUEST} query="" loadLinkPreviews={false} rncpControlEnabled />,
      );
      hydrateAxeThemeColors(document.documentElement);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it('skips link preview fetch when loadLinkPreviews is false', async () => {
    render(<ChatPayloadText text="see https://example.com" query="" loadLinkPreviews={false} />);
    await waitFor(() => {
      expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com');
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
