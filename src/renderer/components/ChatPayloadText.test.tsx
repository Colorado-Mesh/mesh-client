import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

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
    expect(tile.getAttribute('src')).toContain('tile.openstreetmap.org');
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
});
