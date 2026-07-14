import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReticulumAttachmentLine } from './ReticulumAttachmentLine';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'chatPanel.reticulumImageAttachment') return `Image: ${opts?.name}`;
      if (key === 'chatPanel.reticulumAudioAttachment') return `Voice: ${opts?.name}`;
      if (key === 'chatPanel.reticulumFileAttachment') return `File: ${opts?.name}`;
      return key;
    },
  }),
}));

describe('ReticulumAttachmentLine', () => {
  it('renders a read-only image label without open/save controls', () => {
    render(<ReticulumAttachmentLine payload="[file:Screenshot.png:image/png]" />);
    expect(screen.getByText('Image: Screenshot.png')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
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
