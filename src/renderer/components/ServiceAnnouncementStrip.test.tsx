import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { VisibleServiceAnnouncement } from '@/renderer/hooks/useServiceAnnouncements';
import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ServiceAnnouncementStrip } from './ServiceAnnouncementStrip';

const info: VisibleServiceAnnouncement = {
  id: 'info-one',
  severity: 'info',
  title: 'New release notes',
  body: 'Line one\nLine two',
  url: 'https://example.com/notes',
  urlLabel: 'Read notes',
};
const warning: VisibleServiceAnnouncement = {
  id: 'warn-two',
  severity: 'warning',
  title: 'Backbone maintenance',
  body: 'Expect downtime.',
};
const critical: VisibleServiceAnnouncement = {
  id: 'crit-three',
  severity: 'critical',
  title: 'Security fix',
  body: 'Please update.',
};

function renderStrip(announcements: VisibleServiceAnnouncement[]) {
  const onDismiss = vi.fn();
  const onOpenUrl = vi.fn();
  const utils = render(
    <ServiceAnnouncementStrip
      announcements={announcements}
      onDismiss={onDismiss}
      onOpenUrl={onOpenUrl}
    />,
  );
  return { ...utils, onDismiss, onOpenUrl };
}

describe('ServiceAnnouncementStrip', () => {
  it('renders nothing with no announcements', () => {
    const { container } = renderStrip([]);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    [info, 'status'],
    [warning, 'status'],
    [critical, 'alert'],
  ] as const)('uses role %#', (announcement, role) => {
    renderStrip([announcement]);
    expect(screen.getByRole(role)).toHaveTextContent(announcement.title);
  });

  it('renders the body as plain text, not HTML', () => {
    renderStrip([{ ...warning, body: '<img src=x onerror=alert(1)>' }]);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('dismisses the current announcement by id', async () => {
    const { onDismiss } = renderStrip([warning]);
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith('warn-two');
  });

  it('opens the feed link', async () => {
    const { onOpenUrl } = renderStrip([info]);
    await userEvent.click(screen.getByRole('button', { name: /Read notes/ }));
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/notes');
  });

  it('shows no link button without a url, and no next button for one item', () => {
    renderStrip([warning]);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('cycles through multiple announcements', async () => {
    renderStrip([info, warning]);
    expect(screen.getByText('New release notes')).toBeInTheDocument();
    const next = screen.getByRole('button', { name: /next/i });
    expect(next).toHaveTextContent('1 of 2');
    await userEvent.click(next);
    expect(screen.getByText('Backbone maintenance')).toBeInTheDocument();
    expect(next).toHaveTextContent('2 of 2');
    await userEvent.click(next);
    expect(screen.getByText('New release notes')).toBeInTheDocument();
  });

  it('falls back to the first item when the list shrinks', () => {
    const { rerender, onDismiss, onOpenUrl } = renderStrip([info, warning]);
    rerender(
      <ServiceAnnouncementStrip announcements={[]} onDismiss={onDismiss} onOpenUrl={onOpenUrl} />,
    );
    rerender(
      <ServiceAnnouncementStrip
        announcements={[critical]}
        onDismiss={onDismiss}
        onOpenUrl={onOpenUrl}
      />,
    );
    expect(screen.getByText('Security fix')).toBeInTheDocument();
  });

  it.each([info, warning, critical])('has no axe violations (%#)', async (announcement) => {
    const { container } = renderStrip([announcement, warning]);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
