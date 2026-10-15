import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { ConversationSummaryController } from '@/renderer/hooks/useConversationSummary';
import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { CatchUpButton } from './CatchUpButton';
import { ChatSummaryCard } from './ChatSummaryCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
const create = (): ConversationSummaryController & {
  state: NonNullable<ConversationSummaryController['state']>;
} => ({
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
    messageCount: 3,
    truncated: true,
    disclosure: 'provider.test',
  },
});
describe('AI catch up controls', () => {
  it('renders nothing before opt-in', () => {
    const summary = { ...create(), canSummarize: false };
    const { container } = render(
      <>
        <CatchUpButton summary={summary} />
        <ChatSummaryCard summary={summary} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
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
    fireEvent.click(screen.getByRole('button', { name: 'aiSummary.catchUp' }));
    expect(summary.run).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByRole('combobox', { name: 'aiSummary.scope' }), {
      target: { value: '24' },
    });
    expect(summary.setScope).toHaveBeenCalledWith({ kind: 'hours', hours: 24 });
    fireEvent.click(screen.getByRole('button', { name: 'aiSummary.dismiss' }));
    expect(summary.dismiss).toHaveBeenCalledOnce();
    expect(screen.getByText('aiSummary.sentTo')).toBeInTheDocument();
    expect(screen.getByText('aiSummary.truncated')).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
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
    fireEvent.click(screen.getByRole('button', { name: 'aiSummary.cancel' }));
    expect(summary.cancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'aiSummary.regenerate' })).toBeNull();
  });
});
