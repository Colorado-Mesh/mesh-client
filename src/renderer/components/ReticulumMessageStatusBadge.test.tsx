import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReticulumMessageStatusBadge } from '@/renderer/components/ReticulumMessageStatusBadge';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('ReticulumMessageStatusBadge', () => {
  it('shows Delivered for direct Completes', () => {
    render(<ReticulumMessageStatusBadge status="acked" via="tcp" deliveryMethod="direct" />);
    expect(
      screen.getByLabelText('chatPanel.sentViaTcp: chatPanel.reticulumSendDelivered'),
    ).toBeTruthy();
  });

  it('shows Stored at PN for propagated Completes', () => {
    render(<ReticulumMessageStatusBadge status="acked" via="tcp" deliveryMethod="propagated" />);
    expect(
      screen.getByLabelText('chatPanel.sentViaPropagation: chatPanel.reticulumSendStoredAtPn'),
    ).toBeTruthy();
    expect(screen.getByText(/reticulumPnAbbrev/)).toBeTruthy();
  });

  it('shows Queued at PN while propagated Sending', () => {
    render(<ReticulumMessageStatusBadge status="sending" via="tcp" deliveryMethod="propagated" />);
    expect(
      screen.getByLabelText('chatPanel.sentViaPropagation: chatPanel.reticulumSendPropagated'),
    ).toBeTruthy();
  });
});
