import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReticulumAttachmentLine } from './ReticulumAttachmentLine';

const mockRead = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'chatPanel.reticulumImageAttachment') return `Image: ${opts?.name}`;
      if (key === 'chatPanel.reticulumAudioAttachment') return `Voice: ${opts?.name}`;
      if (key === 'chatPanel.reticulumFileAttachment') return `File: ${opts?.name}`;
      if (key === 'chatPayload.reticulumAttachmentImage') return `Attached image: ${opts?.name}`;
      return key;
    },
  }),
}));

beforeEach(() => {
  mockRead.mockReset();
  mockRead.mockResolvedValue({ dataUrl: null });
  Object.defineProperty(window, 'electronAPI', {
    value: { chat: { readReticulumAttachmentAsDataUrl: mockRead } },
    writable: true,
    configurable: true,
  });
});

describe('ReticulumAttachmentLine', () => {
  it('renders a read-only image label without open/save controls', () => {
    render(<ReticulumAttachmentLine payload="[file:Screenshot.png:image/png]" />);
    expect(screen.getByText('Image: Screenshot.png')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('renders cached image attachments as an inline img', async () => {
    mockRead.mockResolvedValue({ dataUrl: 'data:image/png;base64,abc' });
    render(
      <ReticulumAttachmentLine
        payload="[file:Screenshot.png:image/png]"
        attachmentPath="/tmp/mesh/reticulum/attachments/shot.png"
      />,
    );
    await waitFor(() => {
      const img = screen.getByRole('img', { name: 'Attached image: Screenshot.png' });
      expect(img).toHaveAttribute('src', 'data:image/png;base64,abc');
    });
    expect(screen.getByText('Image: Screenshot.png')).toBeInTheDocument();
    expect(mockRead).toHaveBeenCalledWith({
      filePath: '/tmp/mesh/reticulum/attachments/shot.png',
      mimeType: 'image/png',
    });
  });

  it('renders audio and generic file labels', () => {
    const { rerender } = render(<ReticulumAttachmentLine payload="[file:clip.webm:audio/webm]" />);
    expect(screen.getByText('Voice: clip.webm')).toBeInTheDocument();
    rerender(<ReticulumAttachmentLine payload="[file:notes.txt:text/plain]" />);
    expect(screen.getByText('File: notes.txt')).toBeInTheDocument();
  });

  it('returns null for non-attachment payloads', () => {
    const { container } = render(<ReticulumAttachmentLine payload="hello" />);
    expect(container).toBeEmptyDOMElement();
  });
});
