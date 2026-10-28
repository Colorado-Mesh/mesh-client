import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { CHAT_NOTIFICATION_MODE_KEY } from '../lib/chatNotificationPolicy';
import i18n from '../lib/i18n';
import { ChatNotificationPolicySettings } from './ChatNotificationPolicySettings';

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});

it('offers explicit direct-message behavior and accessible, immediately saved choices', async () => {
  const { container, unmount } = render(<ChatNotificationPolicySettings />);
  const control = screen.getByRole('combobox', { name: 'Chat notifications' });
  expect(control).toHaveValue('all');
  control.focus();
  fireEvent.change(control, { target: { value: 'mentions' } });
  expect(control).toHaveValue('mentions');
  expect(control).toHaveFocus();
  expect(localStorage.getItem(CHAT_NOTIFICATION_MODE_KEY)).toBe('mentions');
  hydrateAxeThemeColors(container);
  expect(await axe(container)).toHaveNoViolations();
  unmount();
  render(<ChatNotificationPolicySettings />);
  expect(screen.getByRole('combobox')).toHaveValue('mentions');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'all' } });
  expect(localStorage.getItem(CHAT_NOTIFICATION_MODE_KEY)).toBe('all');
});

it('shows failure and keeps the previous choice until a successful retry', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  render(<ChatNotificationPolicySettings />);
  const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mentions' } });
  expect(screen.getByRole('combobox')).toHaveValue('all');
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
  write.mockRestore();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mentions' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
