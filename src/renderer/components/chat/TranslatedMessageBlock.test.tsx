import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { subscribeOpenSettingRequests } from '@/renderer/lib/openSettingRequest';
import { translationMessageKey } from '@/renderer/lib/translation/helpers';
import {
  resetTranslation,
  translationStatus,
} from '@/renderer/lib/translation/translationTestFixtures';
import { useTranslationStore } from '@/renderer/stores/translationStore';

import { TranslatedMessageBlock } from './TranslatedMessageBlock';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { provider?: string }) =>
      opts?.provider ? `${key} ${opts.provider}` : key,
    i18n: { language: 'en' },
  }),
}));
const text = 'Bonjour à tous';
const key = translationMessageKey('one', text, 'en');
describe('translated message display', () => {
  beforeEach(() => {
    resetTranslation();
  });
  it('keeps original content, identifies provider and toggles the translation with accessible controls', async () => {
    useTranslationStore.getState().setMessage(key, {
      loading: false,
      showTranslation: true,
      result: { ok: true, text: 'Hello everyone', detectedLang: 'fr', provider: 'offline' },
    });
    const resize = vi.fn();
    const { container } = render(
      <div>
        <p>{text}</p>
        <TranslatedMessageBlock messageKey="one" text={text} onContentResize={resize} />
      </div>,
    );
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText('Hello everyone')).toBeInTheDocument();
    expect(screen.getByText(/Bergamot/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'chatTranslation.hideTranslation' }));
    expect(screen.queryByText('Hello everyone')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'chatTranslation.showTranslation' }));
    expect(screen.getByText('Hello everyone')).toBeInTheDocument();
    expect(resize).toHaveBeenCalled();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
  it('links missing packs to App settings and sends online only on explicit click', async () => {
    const status = translationStatus();
    status.libre.enabled = true;
    const api = resetTranslation(status);
    useTranslationStore.getState().setMessage(key, {
      loading: false,
      showTranslation: true,
      result: { ok: false, reason: 'missingPack', missingPacks: ['fr-en'] },
    });
    const requests: unknown[] = [];
    const unsubscribe = subscribeOpenSettingRequests((request) => requests.push(request));
    render(<TranslatedMessageBlock messageKey="one" text={text} />);
    expect(api.translate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'chatTranslation.downloadPacks' }));
    expect(requests).toEqual([{ slot: 'App', id: 'app.translation' }]);
    fireEvent.click(screen.getByRole('button', { name: 'chatTranslation.online' }));
    await waitFor(() => {
      expect(api.translate).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'libre', mode: 'manual' }),
      );
    });
    await screen.findByText('Hello everyone');
    unsubscribe();
  });
  it('shows loading and safe errors without offering a disabled online provider', () => {
    useTranslationStore.getState().setMessage(key, { loading: true, showTranslation: true });
    render(<TranslatedMessageBlock messageKey="one" text={text} />);
    expect(screen.getByText('chatTranslation.loading')).toBeInTheDocument();
    act(() => {
      useTranslationStore.getState().setMessage(key, {
        loading: false,
        showTranslation: true,
        result: { ok: false, reason: 'error' },
      });
    });
    expect(screen.getByText('chatTranslation.error')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'chatTranslation.online' }),
    ).not.toBeInTheDocument();
  });
});
