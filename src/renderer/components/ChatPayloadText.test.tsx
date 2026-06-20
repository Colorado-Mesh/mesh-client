import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
