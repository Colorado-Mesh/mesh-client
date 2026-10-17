import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { ConversationSummaryController } from '@/renderer/hooks/useConversationSummary';
import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import i18n from '@/renderer/lib/i18n';
import { subscribeOpenSettingRequests } from '@/renderer/lib/openSettingRequest';

import { CatchUpButton } from './CatchUpButton';
import { ChatSummaryCard } from './ChatSummaryCard';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
const create = (): ConversationSummaryController & {
  state: NonNullable<ConversationSummaryController['state']>;
} => ({
  key: 'chat',
  showCatchUp: true,
  canSummarize: true,
  scope: { kind: 'unread' },
  setScope: vi.fn(),
  run: vi.fn(),
  cancel: vi.fn(),
  dismiss: vi.fn(),
  pending: false,
  state: {
    requestId: 'id',
    text: 'Synthetic summary',
    streaming: false,
    provider: 'provider.test',
    model: 'model',
    messageCount: 41,
    collectedMessageCount: 44,
    truncated: true,
    disclosure: 'provider.test',
  },
});
describe('AI catch up controls', () => {
  it('renders nothing before opt-in', () => {
    const summary = { ...create(), showCatchUp: false, canSummarize: false };
    const { container } = render(
      <>
        <CatchUpButton summary={summary} />
        <ChatSummaryCard summary={summary} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });
  it('offers settings when opted in without a ready engine, then restores generation controls', async () => {
    const summary = { ...create(), canSummarize: false };
    const openSetting = vi.fn();
    const unsubscribe = subscribeOpenSettingRequests(openSetting);
    try {
      const { container, rerender } = render(<CatchUpButton summary={summary} />);
      fireEvent.click(screen.getByRole('button', { name: 'Set up Catch up' }));
      expect(openSetting).toHaveBeenCalledExactlyOnceWith({ slot: 'App', id: 'app.aiProvider' });
      expect(summary.run).not.toHaveBeenCalled();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      hydrateAxeThemeColors(container);
      expect(await axe(container)).toHaveNoViolations();

      rerender(<CatchUpButton summary={{ ...summary, canSummarize: true }} />);
      fireEvent.click(screen.getByRole('button', { name: 'Catch up' }));
      expect(summary.run).toHaveBeenCalledOnce();
      expect(screen.getByRole('combobox', { name: 'Summary range' })).toBeInTheDocument();
    } finally {
      unsubscribe();
    }
  });
  it('has accessible controls and source disclosure without HTML execution', async () => {
    const summary = create();
    summary.state.text = '<img src=x onerror=alert(1)> plain summary';
    const { container } = render(
      <>
        <CatchUpButton summary={summary} />
        <ChatSummaryCard summary={summary} />
      </>,
    );
    expect(container.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Catch up' }));
    expect(summary.run).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByRole('combobox', { name: 'Summary range' }), {
      target: { value: '24' },
    });
    expect(summary.setScope).toHaveBeenCalledWith({ kind: 'hours', hours: 24 });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(summary.dismiss).toHaveBeenCalledOnce();
    expect(screen.getByText('Sent to provider.test')).toBeInTheDocument();
    expect(screen.getByText(i18n.t('aiSummary.truncated'))).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
  it('distinguishes 41 included messages from the 44 collected at the start', () => {
    render(<ChatSummaryCard summary={create()} />);
    expect(
      screen.getByText('provider.test · model · 41 of 44 collected messages included'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Counts describe this summary snapshot; live unread badges may differ.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
  });

  it('does not claim the offered count was included while preparation is pending', () => {
    const summary = create();
    summary.state.messageCount = null;
    summary.state.streaming = true;
    summary.pending = true;
    render(<ChatSummaryCard summary={summary} />);
    expect(screen.getByText('provider.test · model · 44 messages collected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  });

  it('does not expose or allow copying a rejected repetitive result', () => {
    const summary = create();
    summary.state.error = 'repetitiveOutput';
    summary.state.text = 'morning time, '.repeat(30);
    render(<ChatSummaryCard summary={summary} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'The model started repeating itself. Try a larger model or a shorter range.',
    );
    expect(screen.queryByText(/morning time/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  });

  it('keeps custom hours editable when typing a preset prefix', () => {
    function Controls() {
      const [scope, setScope] = useState<ConversationSummaryController['scope']>({
        kind: 'unread',
      });
      return <CatchUpButton summary={{ ...create(), scope, setScope }} />;
    }
    render(<Controls />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'custom' } });
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '1' } });
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '12' } });
    expect(input).toHaveValue(12);
    expect(screen.getByRole('combobox')).toHaveValue('custom');
  });
  it('offers cancellation while streaming', () => {
    const summary = { ...create(), pending: true };
    summary.state.streaming = true;
    render(<ChatSummaryCard summary={summary} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(summary.cancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull();
  });
});

it('restores a saved custom range and resets draft controls when conversations change', () => {
  const summary = { ...create(), scope: { kind: 'hours' as const, hours: 18 } };
  const { rerender } = render(<CatchUpButton summary={summary} />);
  expect(screen.getByRole('combobox')).toHaveValue('custom');
  expect(screen.getByRole('spinbutton')).toHaveValue(18);
  rerender(<CatchUpButton summary={{ ...create(), key: 'other' }} />);
  expect(screen.getByRole('combobox')).toHaveValue('unread');
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  rerender(<CatchUpButton summary={summary} />);
  expect(screen.getByRole('combobox')).toHaveValue('custom');
  expect(screen.getByRole('spinbutton')).toHaveValue(18);
});
